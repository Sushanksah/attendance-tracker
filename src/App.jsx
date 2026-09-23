import { useEffect, useState } from 'react'
import './App.css'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const initialSubjects = [
  { id: 1, name: 'Business Statistics', total: 12, attended: 8, target: 75 },
  { id: 2, name: 'Marketing', total: 18, attended: 14, target: 80 },
  { id: 3, name: 'Computer Science', total: 15, attended: 12, target: 75 },
]

const emptySubjectForm = {
  name: '',
  total: '',
  attended: '',
  target: '',
}

const emptyAuthForm = {
  fullName: '',
  email: '',
  password: '',
}

function calculatePercentage(attended, total) {
  if (!total || total <= 0) return 0
  return (attended / total) * 100
}

function getStatusText(percentage, target) {
  if (percentage >= target) return 'Safe'
  if (percentage >= target - 5) return 'Warning'
  return 'Below target'
}

function getClassesRequired(attended, total, targetPercent) {
  const attendedCount = Number(attended)
  const totalCount = Number(total)
  const target = Number(targetPercent)

  if (!Number.isFinite(target) || target <= 0 || target >= 100) {
    return 0
  }

  const currentPercentage = calculatePercentage(attendedCount, totalCount)

  if (currentPercentage >= target) {
    return 0
  }

  const value = (target * totalCount - 100 * attendedCount) / (100 - target)
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }

  return Math.ceil(value)
}

function getClassesMissed(attended, total, targetPercent) {
  const attendedCount = Number(attended)
  const totalCount = Number(total)
  const target = Number(targetPercent)

  if (!Number.isFinite(target) || target <= 0 || target > 100) {
    return 0
  }

  const currentPercentage = calculatePercentage(attendedCount, totalCount)

  if (currentPercentage < target) {
    return 0
  }

  const missed = (100 * attendedCount) / target - totalCount
  if (!Number.isFinite(missed) || missed <= 0) {
    return 0
  }

  return Math.floor(missed)
}

function getFutureAttendance(attended, total, futureAttended, futureMissed) {
  const finalTotal = Number(total) + Number(futureAttended) + Number(futureMissed)
  const finalAttended = Number(attended) + Number(futureAttended)

  if (!finalTotal) {
    return 0
  }

  return calculatePercentage(finalAttended, finalTotal)
}

function getOverallTargetPlan(attended, total, targetPercent = 75) {
  if (!Number(total) || Number(total) <= 0) {
    return {
      type: 'neutral',
      text: 'Add your subjects to calculate your overall target plan.',
    }
  }

  const percentage = calculatePercentage(attended, total)
  const target = Number(targetPercent)

  if (percentage >= target) {
    const missed = getClassesMissed(attended, total, target)
    return {
      type: 'safe',
      text: `You can miss ${missed} class${missed === 1 ? '' : 'es'} overall while staying above ${target}%.`,
    }
  }

  const required = getClassesRequired(attended, total, target)
  return {
    type: 'warning',
    text: `You need to attend ${required} more class${required === 1 ? '' : 'es'} overall to reach ${target}%.`,
  }
}

const STORAGE_KEY = 'attendance-tracker-subjects-v1'
const PROFILE_STORAGE_KEY = 'attendance-tracker-profile-v1'

function readStoredSubjects() {
  if (typeof window === 'undefined') {
    return initialSubjects
  }

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : initialSubjects
  } catch {
    return initialSubjects
  }
}

async function saveSubjectToSupabase(session, subject, isUpdate = false) {
  if (!supabase || !session?.user?.id) {
    return
  }

  const payload = {
    user_id: session.user.id,
    subject_name: subject.name,
    total_classes: Number(subject.total),
    attended_classes: Number(subject.attended),
    target_percentage: Number(subject.target),
  }

  if (isUpdate && subject.id) {
    const { error } = await supabase.from('subjects').update(payload).eq('id', subject.id)

    if (error) {
      console.error('Failed to update subject in Supabase:', error)
    }

    return
  }

  const { error } = await supabase.from('subjects').insert([payload])

  if (error) {
    console.error('Failed to save subject to Supabase:', error)
  }
}

async function deleteSubjectFromSupabase(session, subjectId) {
  if (!supabase || !session?.user?.id || !subjectId) {
    return
  }

  const { error } = await supabase.from('subjects').delete().eq('id', subjectId)

  if (error) {
    console.error('Failed to delete subject from Supabase:', error)
  }
}

async function saveProfileToSupabase(session, fullName) {
  if (!supabase || !session?.user?.id) {
    return
  }

  const { error } = await supabase
    .from('profiles')
    .upsert({ id: session.user.id, full_name: fullName })

  if (error) {
    console.error('Failed to upsert profile to Supabase:', error)
  }
}

async function loadProfileFromSupabase(session, setStudentName) {
  if (!supabase || !session?.user?.id) {
    return
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', session.user.id)
    .maybeSingle()

  if (error) {
    console.error('Could not load profile from Supabase:', error)
    return
  }

  if (data?.full_name) {
    setStudentName(data.full_name)
  }
}

async function loadSubjectsFromSupabase(session, setSubjects) {
  if (!supabase || !session?.user?.id) {
    return
  }

  const { data, error } = await supabase
    .from('subjects')
    .select('*')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Could not load subjects from Supabase:', error)
    return
  }

  if (Array.isArray(data) && data.length > 0) {
    const mapped = data.map((item) => ({
      id: item.id,
      name: item.subject_name,
      total: Number(item.total_classes),
      attended: Number(item.attended_classes),
      target: Number(item.target_percentage),
    }))

    setSubjects(mapped)
  }
}

function Dashboard({ session, onLogout }) {
  const [studentName, setStudentName] = useState(() => {
    const savedProfile =
      typeof window !== 'undefined' ? window.localStorage.getItem(PROFILE_STORAGE_KEY) : null

    return session?.user?.user_metadata?.full_name || savedProfile || 'Aisha Rahman'
  })
  const [subjects, setSubjects] = useState(() => readStoredSubjects())
  const [form, setForm] = useState(emptySubjectForm)
  const [editingSubjectId, setEditingSubjectId] = useState(null)
  const [error, setError] = useState('')
  const [plannerTarget, setPlannerTarget] = useState(75)
  const [plannerInputs, setPlannerInputs] = useState({
    1: 0,
    2: 0,
    3: 0,
  })
  const [whatIf, setWhatIf] = useState({
    attended: 160,
    total: 215,
    futureAttended: 10,
    futureMissed: 2,
    target: 75,
  })

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, studentName)
    }

    if (session?.user?.id) {
      saveProfileToSupabase(session, studentName)
    }
  }, [studentName, session])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(subjects))
    }
  }, [subjects])

  useEffect(() => {
    if (!session?.user?.id) {
      return
    }

    loadProfileFromSupabase(session, setStudentName)
    loadSubjectsFromSupabase(session, setSubjects)
  }, [session])

  const totalClasses = subjects.reduce((sum, subject) => sum + Number(subject.total), 0)
  const totalAttended = subjects.reduce(
    (sum, subject) => sum + Number(subject.attended),
    0,
  )
  const overallAttendance = calculatePercentage(totalAttended, totalClasses)
  const targetPercentage = subjects.length
    ? subjects.reduce((sum, subject) => sum + Number(subject.target), 0) / subjects.length
    : 0
  const overallTargetPlan = getOverallTargetPlan(totalAttended, totalClasses, 75)

  const handleSubjectInput = (event) => {
    const { name, value } = event.target
    setForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handlePlannerInput = (subjectId, value) => {
    const nextValue = Number(value)
    setPlannerInputs((current) => ({
      ...current,
      [subjectId]: Number.isFinite(nextValue) ? Math.max(nextValue, 0) : 0,
    }))
  }

  const handleAddSubject = (event) => {
    event.preventDefault()
    setError('')

    const name = form.name.trim()
    const total = Number(form.total)
    const attended = Number(form.attended)
    const target = Number(form.target)

    if (!name) {
      setError('Subject name is required.')
      return
    }

    if (!Number.isFinite(total) || total <= 0) {
      setError('Total classes must be greater than 0.')
      return
    }

    if (!Number.isFinite(attended) || attended < 0) {
      setError('Attended classes cannot be negative.')
      return
    }

    if (attended > total) {
      setError('Attended classes cannot be greater than total classes.')
      return
    }

    if (!Number.isFinite(target) || target < 0 || target > 100) {
      setError('Target percentage must be between 0 and 100.')
      return
    }

    if (editingSubjectId) {
      const updatedSubjects = subjects.map((subject) => {
        if (subject.id !== editingSubjectId) {
          return subject
        }

        return {
          ...subject,
          name,
          total,
          attended,
          target,
        }
      })

      setSubjects(updatedSubjects)

      if (session?.user?.id && supabase) {
        const updatedSubject = updatedSubjects.find((subject) => subject.id === editingSubjectId)
        saveSubjectToSupabase(session, updatedSubject, true)
      }

      setEditingSubjectId(null)
      setForm(emptySubjectForm)
      return
    }

    const newSubject = {
      id: Date.now(),
      name,
      total,
      attended,
      target,
    }

    const nextSubjects = [...subjects, newSubject]
    setSubjects(nextSubjects)

    if (session?.user?.id && supabase) {
      saveSubjectToSupabase(session, newSubject)
    }

    setPlannerInputs((current) => ({
      ...current,
      [newSubject.id]: 0,
    }))
    setForm(emptySubjectForm)
  }

  const handleEditSubject = (subject) => {
    setEditingSubjectId(subject.id)
    setForm({
      name: subject.name,
      total: String(subject.total),
      attended: String(subject.attended),
      target: String(subject.target),
    })
  }

  const handleDeleteSubject = (subjectId) => {
    const filtered = subjects.filter((subject) => subject.id !== subjectId)
    setSubjects(filtered)

    if (session?.user?.id && supabase) {
      deleteSubjectFromSupabase(session, subjectId)
    }

    if (editingSubjectId === subjectId) {
      setEditingSubjectId(null)
      setForm(emptySubjectForm)
    }
  }

  return (
    <main className="app-shell dashboard-shell">
      <div className="dashboard-container">
        <header className="topbar">
          <div>
            <p className="eyebrow">Student account</p>
            <h1>Attendance Tracker</h1>
          </div>
          <div className="profile-box">
            <span>Student</span>
            <strong>{studentName}</strong>
            {onLogout && (
              <button type="button" className="logout-button" onClick={onLogout}>
                Logout
              </button>
            )}
          </div>
        </header>

        <section className="summary-grid">
          <div className="metric-card highlight">
            <span>Overall attendance</span>
            <strong>{overallAttendance.toFixed(2)}%</strong>
          </div>
          <div className="metric-card">
            <span>Total classes</span>
            <strong>{totalClasses}</strong>
          </div>
          <div className="metric-card">
            <span>Total attended</span>
            <strong>{totalAttended}</strong>
          </div>
          <div className="metric-card">
            <span>Subjects</span>
            <strong>{subjects.length}</strong>
          </div>
          <div className="metric-card">
            <span>Average target</span>
            <strong>{targetPercentage.toFixed(0)}%</strong>
          </div>
        </section>

        <div className={`overall-plan-box ${overallTargetPlan.type}`}>
          <strong>Overall target plan</strong>
          <p>{overallTargetPlan.text}</p>
        </div>

        <section className="content-grid">
          <div className="panel">
            <h2>Add subject</h2>

            <form onSubmit={handleAddSubject} className="subject-form">
              <label>
                <span>Subject name</span>
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={handleSubjectInput}
                  placeholder="Business Statistics"
                />
              </label>

              <div className="two-column">
                <label>
                  <span>Total classes</span>
                  <input
                    type="number"
                    name="total"
                    min="1"
                    value={form.total}
                    onChange={handleSubjectInput}
                    placeholder="12"
                  />
                </label>

                <label>
                  <span>Attended classes</span>
                  <input
                    type="number"
                    name="attended"
                    min="0"
                    value={form.attended}
                    onChange={handleSubjectInput}
                    placeholder="8"
                  />
                </label>
              </div>

              <label>
                <span>Target percentage</span>
                <input
                  type="number"
                  name="target"
                  min="0"
                  max="100"
                  value={form.target}
                  onChange={handleSubjectInput}
                  placeholder="75"
                />
              </label>

              {error && <div className="feedback error">{error}</div>}

              <div className="form-actions">
                <button type="submit" className="primary-button">
                  {editingSubjectId ? 'Update subject' : 'Add subject'}
                </button>

                {editingSubjectId && (
                  <button
                    type="button"
                    className="secondary-button button-ghost"
                    onClick={() => {
                      setEditingSubjectId(null)
                      setForm(emptySubjectForm)
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="panel">
            <h2>Student summary</h2>
            <div className="summary-list">
              <div className="editable-row">
                <span>Student name</span>
                <input
                  type="text"
                  value={studentName}
                  onChange={(event) => setStudentName(event.target.value)}
                  className="name-input"
                />
              </div>
              <div>
                <span>Overall attendance</span>
                <strong>{overallAttendance.toFixed(2)}%</strong>
              </div>
              <div>
                <span>Overall target plan</span>
                <strong>{overallTargetPlan.text}</strong>
              </div>
              <div>
                <span>Subjects</span>
                <strong>{subjects.length}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="panel table-panel">
          <h2>Subject table</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Attended</th>
                  <th>Total</th>
                  <th>Attendance %</th>
                  <th>Target</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((subject) => {
                  const percentage = calculatePercentage(subject.attended, subject.total)
                  const status = getStatusText(percentage, subject.target)

                  return (
                    <tr key={subject.id}>
                      <td>{subject.name}</td>
                      <td>{subject.attended}</td>
                      <td>{subject.total}</td>
                      <td>{percentage.toFixed(2)}%</td>
                      <td>{subject.target}%</td>
                      <td>
                        <span
                          className={`status-badge ${status.toLowerCase().replace(/\s+/g, '-')}`}
                        >
                          {status}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="small-button" onClick={() => handleEditSubject(subject)}>
                            Edit
                          </button>
                          <button type="button" className="small-button danger" onClick={() => handleDeleteSubject(subject.id)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel planner-panel">
          <div className="planner-header">
            <h2>Attendance Planner</h2>
            <label className="target-select">
              <span>Target</span>
              <select value={plannerTarget} onChange={(event) => setPlannerTarget(Number(event.target.value))}>
                <option value={75}>75%</option>
                <option value={76}>76%</option>
                <option value={80}>80%</option>
              </select>
            </label>
          </div>

          <div className="planner-list">
            {subjects.map((subject) => {
              const upcomingClasses = Number(plannerInputs[subject.id] || 0)
              const futureAttendance = calculatePercentage(
                subject.attended + upcomingClasses,
                subject.total + upcomingClasses,
              )

              return (
                <div className="planner-item" key={subject.id}>
                  <div className="planner-top-row">
                    <div>
                      <h3>{subject.name}</h3>
                      <p>
                        Current: {subject.attended}/{subject.total} ({calculatePercentage(subject.attended, subject.total).toFixed(2)}%)
                      </p>
                    </div>
                    <div className="planner-stat">
                      <span>Future attendance</span>
                      <strong>{futureAttendance.toFixed(2)}%</strong>
                    </div>
                  </div>

                  <label className="planner-field">
                    <span>How many upcoming classes will I attend?</span>
                    <input
                      type="number"
                      min="0"
                      value={upcomingClasses}
                      onChange={(event) => handlePlannerInput(subject.id, event.target.value)}
                    />
                  </label>

                  <div className="planner-metrics">
                    <div>
                      <span>Classes required</span>
                      <strong>{getClassesRequired(subject.attended, subject.total, plannerTarget)}</strong>
                    </div>
                    <div>
                      <span>Classes can be missed</span>
                      <strong>{getClassesMissed(subject.attended, subject.total, plannerTarget)}</strong>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel whatif-panel">
          <h2>What-if Calculator</h2>

          <div className="whatif-grid">
            <label>
              <span>Current attended</span>
              <input
                type="number"
                min="0"
                value={whatIf.attended}
                onChange={(event) =>
                  setWhatIf((current) => ({
                    ...current,
                    attended: Number(event.target.value),
                  }))
                }
              />
            </label>

            <label>
              <span>Current total</span>
              <input
                type="number"
                min="1"
                value={whatIf.total}
                onChange={(event) =>
                  setWhatIf((current) => ({
                    ...current,
                    total: Number(event.target.value),
                  }))
                }
              />
            </label>

            <label>
              <span>Future classes attended</span>
              <input
                type="number"
                min="0"
                value={whatIf.futureAttended}
                onChange={(event) =>
                  setWhatIf((current) => ({
                    ...current,
                    futureAttended: Number(event.target.value),
                  }))
                }
              />
            </label>

            <label>
              <span>Future classes missed</span>
              <input
                type="number"
                min="0"
                value={whatIf.futureMissed}
                onChange={(event) =>
                  setWhatIf((current) => ({
                    ...current,
                    futureMissed: Number(event.target.value),
                  }))
                }
              />
            </label>

            <label>
              <span>Target attendance</span>
              <input
                type="number"
                min="0"
                max="100"
                value={whatIf.target}
                onChange={(event) =>
                  setWhatIf((current) => ({
                    ...current,
                    target: Number(event.target.value),
                  }))
                }
              />
            </label>
          </div>

          <div className="whatif-results">
            <div>
              <span>Future attendance %</span>
              <strong>
                {getFutureAttendance(
                  whatIf.attended,
                  whatIf.total,
                  whatIf.futureAttended,
                  whatIf.futureMissed,
                ).toFixed(2)}%
              </strong>
            </div>

            <div>
              <span>Classes required</span>
              <strong>
                {getClassesRequired(
                  whatIf.attended + whatIf.futureAttended,
                  whatIf.total + whatIf.futureAttended + whatIf.futureMissed,
                  whatIf.target,
                )}
              </strong>
            </div>

            <div>
              <span>Classes can be missed</span>
              <strong>
                {getClassesMissed(
                  whatIf.attended + whatIf.futureAttended,
                  whatIf.total + whatIf.futureAttended + whatIf.futureMissed,
                  whatIf.target,
                )}
              </strong>
            </div>

            <div>
              <span>Target achieved</span>
              <strong>
                {getFutureAttendance(
                  whatIf.attended,
                  whatIf.total,
                  whatIf.futureAttended,
                  whatIf.futureMissed,
                ) >= Number(whatIf.target)
                  ? 'Yes'
                  : 'No'}
              </strong>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function AuthScreen() {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState(emptyAuthForm)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!supabase) return undefined

    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (active) {
        setSession(newSession)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const handleLogout = async () => {
    if (!supabase) return

    setLoading(true)
    const { error } = await supabase.auth.signOut()

    if (error) {
      setError(error.message)
    } else {
      setSession(null)
      setMessage('You have been logged out.')
    }

    setLoading(false)
  }

  if (session) {
    return <Dashboard session={session} onLogout={handleLogout} />
  }

  const updateField = (event) => {
    const { name, value } = event.target
    setForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const resetFeedback = () => {
    setError('')
    setMessage('')
  }

  const handleAuth = async (event) => {
    event.preventDefault()
    resetFeedback()

    if (!supabase) {
      setError('Add your Supabase URL and anon key to .env before using login or signup.')
      return
    }

    const email = form.email.trim()
    const password = form.password
    const fullName = form.fullName.trim()

    if (!email || !password) {
      setError('Email and password are required.')
      return
    }

    if (mode === 'signup' && !fullName) {
      setError('Please enter your full name.')
      return
    }

    setLoading(true)

    try {
      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            },
          },
        })

        if (signUpError) throw signUpError

        setMessage('Your account was created. Check your inbox for confirmation.')
        setForm(emptyAuthForm)
      } else if (mode === 'reset') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        })

        if (resetError) throw resetError

        setMessage('Password reset email sent. Please check your inbox.')
        setForm((current) => ({ ...current, email: '' }))
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (signInError) throw signInError

        setMessage('You are logged in successfully.')
      }
    } catch (authError) {
      setError(authError.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="app-shell auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Authentication</p>
        <h1>{mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Reset password' : 'Login'}</h1>

        {!isSupabaseConfigured && (
          <div className="warning-box">
            <strong>Supabase not configured</strong>
            <p>
              Add your project URL and anon key to the .env file before testing sign up or login.
            </p>
          </div>
        )}

        <div className="mode-switch" role="tablist" aria-label="Authentication mode selector">
          <button
            type="button"
            className={mode === 'login' ? 'mode-button active' : 'mode-button'}
            onClick={() => {
              setMode('login')
              resetFeedback()
            }}
          >
            Login
          </button>
          <button
            type="button"
            className={mode === 'signup' ? 'mode-button active' : 'mode-button'}
            onClick={() => {
              setMode('signup')
              resetFeedback()
            }}
          >
            Sign up
          </button>
          <button
            type="button"
            className={mode === 'reset' ? 'mode-button active' : 'mode-button'}
            onClick={() => {
              setMode('reset')
              resetFeedback()
            }}
          >
            Forgot password
          </button>
        </div>

        <form className="auth-form" onSubmit={handleAuth}>
          {mode === 'signup' && (
            <label className="field">
              <span>Full name</span>
              <input
                type="text"
                name="fullName"
                value={form.fullName}
                onChange={updateField}
                placeholder="Enter your name"
                autoComplete="name"
              />
            </label>
          )}

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={updateField}
              placeholder="student@example.com"
              autoComplete="email"
            />
          </label>

          {mode !== 'reset' && (
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                name="password"
                value={form.password}
                onChange={updateField}
                placeholder="Enter your password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </label>
          )}

          {error && <div className="feedback error">{error}</div>}
          {message && <div className="feedback success">{message}</div>}

          <button type="submit" className="primary-button" disabled={loading || !isSupabaseConfigured}>
            {loading
              ? mode === 'signup'
                ? 'Creating account...'
                : mode === 'reset'
                  ? 'Sending email...'
                  : 'Logging in...'
              : mode === 'signup'
                ? 'Sign up'
                : mode === 'reset'
                  ? 'Send reset email'
                  : 'Login'}
          </button>
        </form>

        {session && (
          <button type="button" className="secondary-button" onClick={handleLogout}>
            Logout
          </button>
        )}
      </section>
    </main>
  )
}

function App() {
  if (!isSupabaseConfigured) {
    return <Dashboard />
  }

  return <AuthScreen />
}

export default App
