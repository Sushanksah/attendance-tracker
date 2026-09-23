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

function getOverallPlanDetails(attended, total, targetPercent = 75) {
  if (!Number(total) || Number(total) <= 0) {
    return {
      type: 'neutral',
      count: 0,
      progress: 0,
      label: 'Add subjects',
      text: 'Add subjects to see your overall attendance plan.',
    }
  }

  const percentage = calculatePercentage(attended, total)
  const target = Number(targetPercent)

  if (percentage >= target) {
    const count = getClassesMissed(attended, total, target)
    return {
      type: 'safe',
      count,
      progress: Math.min(100, (count / Math.max(1, total + count)) * 100),
      label: 'Classes can be missed',
      text: `You can miss ${count} class${count === 1 ? '' : 'es'} and stay at or above ${target}%.`,
    }
  }

  const count = getClassesRequired(attended, total, target)
  return {
    type: 'warning',
    count,
    progress: Math.min(100, (count / Math.max(1, total + count)) * 100),
    label: 'Classes to attend',
    text: `You need to attend ${count} more class${count === 1 ? '' : 'es'} to reach ${target}%.`,
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
    return null
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
      return null
    }

    return subject
  }

  const { data, error } = await supabase.from('subjects').insert([payload]).select().single()

  if (error) {
    console.error('Failed to save subject to Supabase:', error)
    return null
  }

  return data
    ? {
        id: data.id,
        name: data.subject_name,
        total: Number(data.total_classes),
        attended: Number(data.attended_classes),
        target: Number(data.target_percentage),
      }
    : null
}

async function saveAttendanceLogToSupabase(session, subject, action, notes) {
  if (!supabase || !session?.user?.id || !subject?.id) {
    return
  }

  const { error } = await supabase.from('attendance_logs').insert([
    {
      user_id: session.user.id,
      subject_id: subject.id,
      action,
      attended_classes: Number(subject.attended),
      total_classes: Number(subject.total),
      notes,
    },
  ])

  if (error) {
    console.error('Failed to save attendance log in Supabase:', error)
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

async function saveExtendedProfileToSupabase(session, profile) {
  if (!supabase || !session?.user?.id) {
    return false
  }

  const { error } = await supabase
    .from('profiles')
    .upsert({
      id: session.user.id,
      full_name: profile.studentName.trim(),
      prn_number: profile.prnNumber.trim() || null,
      university_email: profile.universityEmail.trim().toLowerCase() || null,
      avatar_url: profile.avatarUrl || null,
    })

  if (error) {
    console.error('Failed to save extended profile to Supabase:', error)
    return false
  }

  return true
}

async function uploadProfilePhoto(session, file) {
  if (!supabase || !session?.user?.id || !file) {
    return null
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.')
  }

  if (file.size > 2 * 1024 * 1024) {
    throw new Error('Profile photos must be 2 MB or smaller.')
  }

  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${session.user.id}/profile.${extension}`
  const { error: uploadError } = await supabase.storage
    .from('profile-photos')
    .upload(path, file, { upsert: true, contentType: file.type })

  if (uploadError) {
    console.error('Failed to upload profile photo:', uploadError)
    throw new Error('Could not upload the profile photo. Check the Supabase storage setup.')
  }

  const { data, error: signedUrlError } = await supabase.storage
    .from('profile-photos')
    .createSignedUrl(path, 60 * 60 * 24 * 7)

  if (signedUrlError) {
    console.error('Failed to create profile photo URL:', signedUrlError)
    throw new Error('Photo uploaded, but it could not be displayed.')
  }

  return data.signedUrl
}

async function loadProfileFromSupabase(session, setProfile) {
  if (!supabase || !session?.user?.id) {
    return
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, prn_number, university_email, avatar_url')
    .eq('id', session.user.id)
    .maybeSingle()

  if (error) {
    console.error('Could not load profile from Supabase:', error)
    return
  }

  if (data?.full_name) {
    setProfile((current) => ({
      ...current,
      studentName: data.full_name,
      prnNumber: data.prn_number || '',
      universityEmail: data.university_email || '',
      avatarUrl: data.avatar_url || '',
    }))
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

  const mapped = (data || []).map((item) => ({
    id: item.id,
    name: item.subject_name,
    total: Number(item.total_classes),
    attended: Number(item.attended_classes),
    target: Number(item.target_percentage),
  }))

  setSubjects(mapped)
}

function Dashboard({ session, onLogout }) {
  const [profile, setProfile] = useState(() => {
    const savedProfile =
      typeof window !== 'undefined' ? window.localStorage.getItem(PROFILE_STORAGE_KEY) : null

    const savedName = session?.user?.user_metadata?.full_name || savedProfile || 'Aisha Rahman'
    return {
      studentName: savedName,
      prnNumber: '',
      universityEmail: '',
      avatarUrl: '',
    }
  })
  const [profileMessage, setProfileMessage] = useState('')
  const [profileError, setProfileError] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileEditing, setProfileEditing] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
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
      window.localStorage.setItem(PROFILE_STORAGE_KEY, profile.studentName)
    }

    if (session?.user?.id && profile.studentName) {
      saveProfileToSupabase(session, profile.studentName)
    }
  }, [profile.studentName, session])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(subjects))
    }
  }, [subjects])

  useEffect(() => {
    if (!session?.user?.id) {
      return
    }

    loadProfileFromSupabase(session, setProfile)
    loadSubjectsFromSupabase(session, setSubjects)
  }, [session])

  const handleProfilePhotoChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setProfileError('')
    setProfileMessage('')
    setProfileSaving(true)

    try {
      const avatarUrl = await uploadProfilePhoto(session, file)
      if (!avatarUrl) throw new Error('Profile photo upload is unavailable.')
      setProfile((current) => ({ ...current, avatarUrl }))
      await saveExtendedProfileToSupabase(session, { ...profile, avatarUrl })
      setProfileMessage('Profile photo updated.')
    } catch (uploadError) {
      setProfileError(uploadError.message || 'Could not update profile photo.')
    } finally {
      setProfileSaving(false)
      event.target.value = ''
    }
  }

  const handleProfileSave = async (event) => {
    event.preventDefault()
    setProfileError('')
    setProfileMessage('')

    if (profile.universityEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.universityEmail)) {
      setProfileError('Please enter a valid university email address.')
      return
    }

    setProfileSaving(true)
    const saved = await saveExtendedProfileToSupabase(session, profile)
    setProfileSaving(false)
    if (saved) {
      setProfileMessage('Profile details saved.')
      setProfileEditing(false)
    } else {
      setProfileMessage('Profile details could not be saved.')
    }
  }

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
  const overallPlanDetails = getOverallPlanDetails(totalAttended, totalClasses, 75)

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

  const handleAddSubject = async (event) => {
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

    if (session?.user?.id && supabase) {
      const savedSubject = await saveSubjectToSupabase(session, newSubject)
      if (savedSubject) {
        newSubject.id = savedSubject.id
      }
    }

    const nextSubjects = [...subjects, newSubject]
    setSubjects(nextSubjects)

    setPlannerInputs((current) => ({
      ...current,
      [newSubject.id]: 0,
    }))
    setForm(emptySubjectForm)
  }

  const handleMarkAttendance = async (subjectId, attended) => {
    setError('')

    const subject = subjects.find((item) => item.id === subjectId)
    if (!subject) {
      setError('Could not find that subject.')
      return
    }

    const updatedSubject = {
      ...subject,
      total: Number(subject.total) + 1,
      attended: Number(subject.attended) + (attended ? 1 : 0),
    }

    setSubjects((current) =>
      current.map((item) => (item.id === subjectId ? updatedSubject : item)),
    )

    if (session?.user?.id && supabase) {
      const savedSubject = await saveSubjectToSupabase(session, updatedSubject, true)
      if (!savedSubject) {
        setError('Attendance changed locally, but could not be saved to Supabase.')
        return
      }

      await saveAttendanceLogToSupabase(
        session,
        updatedSubject,
        'update',
        attended ? 'Marked present' : 'Marked absent',
      )
    }
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
          <div className="profile-menu">
            <button
              type="button"
              className="profile-box"
              onClick={() => setProfileMenuOpen((current) => !current)}
              aria-expanded={profileMenuOpen}
              aria-label="Open profile menu"
            >
              <div className="profile-box-heading">
              <div className="header-avatar">
                {profile.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="" />
                ) : (
                  <span>{profile.studentName.charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div>
                <strong>{profile.studentName}</strong>
              </div>
              </div>
              {profile.prnNumber && <small>PRN: {profile.prnNumber}</small>}
            </button>
            {profileMenuOpen && (
              <div className="profile-dropdown">
                <button
                  type="button"
                  onClick={() => {
                    setProfileEditing(true)
                    setProfileMenuOpen(false)
                    setProfileMessage('')
                    setProfileError('')
                  }}
                >
                  Update profile
                </button>
                {onLogout && (
                  <button type="button" onClick={onLogout}>
                    Logout
                  </button>
                )}
              </div>
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

          <div className="panel plan-ring-panel">
            <div className="panel-heading-row">
              <div>
                <p className="panel-kicker">Overall target</p>
                <h2>75% attendance plan</h2>
              </div>
              <span className={`plan-state ${overallPlanDetails.type}`}>
                {overallPlanDetails.type === 'safe' ? 'On track' : overallPlanDetails.type === 'warning' ? 'Action needed' : 'Waiting'}
              </span>
            </div>
            <div
              className={`plan-ring ${overallPlanDetails.type}`}
              style={{ '--ring-progress': `${overallPlanDetails.progress}%` }}
              role="img"
              aria-label={`${overallPlanDetails.count} ${overallPlanDetails.label.toLowerCase()}`}
            >
              <div className="plan-ring-inner">
                <strong>{overallPlanDetails.count}</strong>
                <span>{overallPlanDetails.label}</span>
              </div>
            </div>
            <p className="plan-ring-text">{overallPlanDetails.text}</p>
            <div className="plan-ring-caption">
              Current overall attendance: <strong>{overallAttendance.toFixed(2)}%</strong>
            </div>
          </div>
        </section>

        {profileEditing && (
        <section className="content-grid profile-edit-grid">
          <div className="panel">
            <h2>Profile</h2>
            <div className="profile-editor">
            <div className="avatar-preview">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="Profile" />
              ) : (
                <span>{profile.studentName.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <label className={`small-button upload-button ${!profileEditing ? 'disabled' : ''}`}>
              {profileSaving ? 'Uploading...' : 'Upload profile photo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleProfilePhotoChange}
                disabled={profileSaving || !profileEditing}
              />
            </label>
            </div>
            <form className="profile-form" onSubmit={handleProfileSave}>
            <label>
              <span>Student name</span>
              <input
                type="text"
                value={profile.studentName}
                disabled={!profileEditing}
                onChange={(event) =>
                  setProfile((current) => ({ ...current, studentName: event.target.value }))
                }
              />
            </label>
            <label>
              <span>PRN number</span>
              <input
                type="text"
                value={profile.prnNumber}
                disabled={!profileEditing}
                onChange={(event) =>
                  setProfile((current) => ({ ...current, prnNumber: event.target.value }))
                }
                placeholder="Enter your PRN"
              />
            </label>
            <label>
              <span>University email (optional)</span>
              <input
                type="email"
                value={profile.universityEmail}
                disabled={!profileEditing}
                onChange={(event) =>
                  setProfile((current) => ({ ...current, universityEmail: event.target.value }))
                }
                placeholder="student@university.ac.in"
              />
            </label>
            {profileError && <div className="feedback error">{profileError}</div>}
            {profileMessage && <div className="feedback success">{profileMessage}</div>}
            {profileEditing && (
              <div className="form-actions">
                <button type="submit" className="primary-button" disabled={profileSaving}>
                  {profileSaving ? 'Saving...' : 'Save profile'}
                </button>
                <button
                  type="button"
                  className="secondary-button button-ghost"
                  onClick={() => {
                    setProfileEditing(false)
                    setProfileError('')
                    setProfileMessage('')
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
            </form>
            <div className="summary-list">
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
        )}

        <section className="panel table-panel">
          <h2>Subject table</h2>
          <p className="section-help">
            After each class, click Present or Absent. The total and attended counts will update automatically.
          </p>
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
                          <button
                            type="button"
                            className="small-button present-button"
                            onClick={() => handleMarkAttendance(subject.id, true)}
                          >
                            Present
                          </button>
                          <button
                            type="button"
                            className="small-button absent-button"
                            onClick={() => handleMarkAttendance(subject.id, false)}
                          >
                            Absent
                          </button>
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
