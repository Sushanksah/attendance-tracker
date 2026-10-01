import { useCallback, useEffect, useState } from 'react'
import writeExcelFile from 'write-excel-file/browser'
import './App.css'
import { isSupabaseConfigured, supabase } from './lib/supabase'

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

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-google-identity]')
    if (existingScript) {
      existingScript.addEventListener('load', resolve, { once: true })
      existingScript.addEventListener('error', reject, { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.googleIdentity = 'true'
    script.onload = resolve
    script.onerror = () => reject(new Error('Google Calendar could not be loaded.'))
    document.head.appendChild(script)
  })
}

function getCalendarDateRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 5)
  return { timeMin: start.toISOString(), timeMax: end.toISOString() }
}

function getCalendarEventDate(event) {
  const value = event.start?.dateTime || event.start?.date
  if (!value) return null

  if (event.start?.date) {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day)
  }

  return new Date(value)
}

function getCalendarEventEndDate(event) {
  const value = event.end?.dateTime || event.end?.date
  if (!value) return null

  if (event.end?.date) {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day)
  }

  return new Date(value)
}

function getCalendarEventKey(event) {
  return `${event.calendarId || event.calendarName || 'calendar'}-${event.id}`
}

function getProfilePhotoPath(value, userId) {
  if (!value) return ''
  if (value.startsWith(`${userId}/`)) return value

  try {
    const pathname = new URL(value).pathname
    const markers = ['/object/sign/profile-photos/', '/object/public/profile-photos/']
    const marker = markers.find((candidate) => pathname.includes(candidate))
    if (!marker) return ''

    const path = decodeURIComponent(pathname.split(marker).pop() || '')
    return path.startsWith(`${userId}/`) ? path : ''
  } catch {
    return ''
  }
}

async function getProfilePhotoUrl(path) {
  if (!supabase || !path) return ''

  const { data, error } = await supabase.storage
    .from('profile-photos')
    .createSignedUrl(path, 60 * 60 * 24 * 7)

  if (error) {
    console.error('Could not create a fresh profile photo URL:', error)
    return ''
  }

  return data.signedUrl
}

function getCalendarAttendanceStatus(status) {
  if (status === 'attended') return 'present'
  if (status === 'missed') return 'absent'
  return status
}

function getLocalDateKey(date) {
  if (!date) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getCalendarDayLabel(date) {
  if (!date) return 'Scheduled'
  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function isCancelledCalendarEvent(event) {
  const status = `${event.status || ''} ${event.summary || ''} ${event.description || ''}`.toLowerCase()
  return status.includes('cancelled') || status.includes('canceled')
}

async function getGoogleApiError(response, fallbackMessage) {
  try {
    const data = await response.json()
    const message = data.error?.message || data.error_description
    if (message) return `${fallbackMessage} (${message})`
  } catch {
    // Use the fallback when Google does not return JSON.
  }

  return `${fallbackMessage} (HTTP ${response.status})`
}

function formatSupabaseError(error) {
  return [
    error?.code ? `Code ${error.code}` : '',
    error?.message || '',
    error?.details ? `Details: ${error.details}` : '',
    error?.hint ? `Hint: ${error.hint}` : '',
  ]
    .filter(Boolean)
    .join(' — ')
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

  if (!Number.isFinite(target) || target < 0 || target > 100) {
    return 0
  }

  const currentPercentage = calculatePercentage(attendedCount, totalCount)

  if (currentPercentage >= target) {
    return 0
  }

  if (target === 100) {
    return null
  }

  if (target === 0) {
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
  if (count === null) {
    return {
      type: 'warning',
      count: null,
      progress: 0,
      label: 'Classes to attend',
      text: 'A 100% attendance target cannot be reached by attending a finite number of additional classes.',
    }
  }

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
    return []
  }

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    const parsed = saved ? JSON.parse(saved) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (subject) =>
        subject &&
        typeof subject.name === 'string' &&
        Number.isFinite(Number(subject.total)) &&
        Number(subject.total) > 0 &&
        Number.isFinite(Number(subject.attended)) &&
        Number(subject.attended) >= 0 &&
        Number(subject.attended) <= Number(subject.total) &&
        Number.isFinite(Number(subject.target)) &&
        Number(subject.target) >= 0 &&
        Number(subject.target) <= 100,
    )
  } catch {
    return []
  }
}

async function saveSubjectToSupabase(session, subject, isUpdate = false) {
  if (!supabase || !session?.user?.id) {
    throw new Error('Your session is unavailable. Please sign in again before saving.')
  }

  const payload = {
    user_id: session.user.id,
    subject_name: subject.name,
    total_classes: Number(subject.total),
    attended_classes: Number(subject.attended),
    target_percentage: Number(subject.target),
  }

  if (isUpdate && subject.id) {
    const { data, error } = await supabase
      .from('subjects')
      .update(payload)
      .eq('id', subject.id)
      .select('id, subject_name, total_classes, attended_classes, target_percentage')
      .single()

    if (error) {
      console.error('Failed to update subject in Supabase:', error)
      throw error
    }

    return {
      id: data.id,
      name: data.subject_name,
      total: Number(data.total_classes),
      attended: Number(data.attended_classes),
      target: Number(data.target_percentage),
    }
  }

  const { data, error } = await supabase.from('subjects').insert([payload]).select().single()

  if (error) {
    console.error('Failed to save subject to Supabase:', error)
    throw error
  }

  if (!data) {
    throw new Error('The database did not confirm that the subject was saved.')
  }

  return {
    id: data.id,
    name: data.subject_name,
    total: Number(data.total_classes),
    attended: Number(data.attended_classes),
    target: Number(data.target_percentage),
  }
}

async function importLocalSubjectsToSupabase(session, localSubjects) {
  if (!supabase || !session?.user?.id || localSubjects.length === 0) {
    throw new Error('There are no saved subjects to import.')
  }

  const payload = localSubjects.map((subject) => ({
    user_id: session.user.id,
    subject_name: subject.name.trim(),
    total_classes: Number(subject.total),
    attended_classes: Number(subject.attended),
    target_percentage: Number(subject.target),
  }))
  const { data, error } = await supabase
    .from('subjects')
    .insert(payload)
    .select('id, subject_name, total_classes, attended_classes, target_percentage')

  if (error) {
    console.error('Failed to import browser subjects to Supabase:', error)
    throw error
  }

  return data.map((item) => ({
    id: item.id,
    name: item.subject_name,
    total: Number(item.total_classes),
    attended: Number(item.attended_classes),
    target: Number(item.target_percentage),
  }))
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
    throw new Error('Your session is unavailable. Please sign in again before deleting.')
  }

  const { error } = await supabase.from('subjects').delete().eq('id', subjectId)

  if (error) {
    console.error('Failed to delete subject from Supabase:', error)
    throw error
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
      avatar_url: profile.avatarPath || null,
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

  const url = await getProfilePhotoUrl(path)
  if (!url) throw new Error('Photo uploaded, but it could not be displayed.')

  return { path, url }
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

  if (data) {
    const avatarPath = getProfilePhotoPath(data.avatar_url, session.user.id)
    const avatarUrl = await getProfilePhotoUrl(avatarPath)
    setProfile((current) => ({
      ...current,
      studentName: data.full_name || current.studentName,
      prnNumber: data.prn_number || '',
      universityEmail: data.university_email || '',
      avatarPath,
      avatarUrl,
    }))

    if (avatarPath && data.avatar_url !== avatarPath) {
      const { error: migrationError } = await supabase
        .from('profiles')
        .update({ avatar_url: avatarPath })
        .eq('id', session.user.id)
      if (migrationError) {
        console.error('Could not migrate the saved profile photo path:', migrationError)
      }
    }
  }
}

async function loadSubjectsFromSupabase(session) {
  if (!supabase || !session?.user?.id) {
    throw new Error('Supabase is not configured for this deployment.')
  }

  const { data, error } = await supabase
    .from('subjects')
    .select('*')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Could not load subjects from Supabase:', error)
    throw error
  }

  const mapped = (data || []).map((item) => ({
    id: item.id,
    name: item.subject_name,
    total: Number(item.total_classes),
    attended: Number(item.attended_classes),
    target: Number(item.target_percentage),
  }))

  return mapped
}

async function loadCalendarAttendanceStatuses(session) {
  if (!supabase || !session?.user?.id) {
    throw new Error('Sign in to sync calendar attendance across devices.')
  }

  const { data, error } = await supabase
    .from('calendar_attendance')
    .select('event_key, status')
    .eq('user_id', session.user.id)

  if (error) {
    console.error('Could not load calendar attendance statuses:', error)
    throw new Error(
      `Calendar attendance could not be loaded from Supabase. Run the latest supabase-schema.sql in the Supabase SQL Editor. ${formatSupabaseError(error)}`,
    )
  }

  return Object.fromEntries(
    (data || []).map((record) => [record.event_key, record.status]),
  )
}

async function syncCalendarAttendanceFromSupabase(session, events, subjects) {
  if (!supabase || !session?.user?.id) {
    throw new Error('Sign in to sync calendar attendance across devices.')
  }

  const localKey = `attendance-calendar-status-${session.user.id}`
  let localStatuses = {}
  try {
    localStatuses = JSON.parse(window.localStorage.getItem(localKey) || '{}')
  } catch {
    console.error('Could not read saved calendar attendance from this browser.')
  }

  const legacyRows = events.flatMap((event) => {
    const eventKey = getCalendarEventKey(event)
    const status = getCalendarAttendanceStatus(localStatuses[eventKey])
    if (!['present', 'absent'].includes(status)) return []

    const title = `${event.summary || ''} ${event.description || ''}`.toLowerCase()
    const matchingSubject = subjects
      .filter((subject) => title.includes(subject.name.toLowerCase()))
      .sort((first, second) => second.name.length - first.name.length)[0]
    if (!matchingSubject) return []

    return [{
      user_id: session.user.id,
      subject_id: matchingSubject.id,
      event_key: eventKey,
      status,
    }]
  })

  const savedStatuses = await loadCalendarAttendanceStatuses(session)
  const rowsToImport = legacyRows.filter((row) => !savedStatuses[row.event_key])
  let importWarning = ''

  if (rowsToImport.length > 0) {
    const { error: migrationError } = await supabase
      .from('calendar_attendance')
      .upsert(rowsToImport, {
        onConflict: 'user_id,event_key',
        ignoreDuplicates: true,
      })
    if (migrationError) {
      console.error('Could not migrate saved browser attendance statuses:', migrationError)
      importWarning =
        `Some attendance marks saved only in this browser could not be synchronized. Check the calendar_attendance table and its RLS policies in Supabase. ${formatSupabaseError(migrationError)}`
    }
  }

  const importedStatuses = importWarning
    ? {}
    : Object.fromEntries(rowsToImport.map((row) => [row.event_key, row.status]))
  const mergedStatuses = { ...localStatuses, ...savedStatuses, ...importedStatuses }
  window.localStorage.setItem(localKey, JSON.stringify(mergedStatuses))
  return { statuses: mergedStatuses, warning: importWarning }
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
      avatarPath: '',
      avatarUrl: '',
    }
  })
  const [profileMessage, setProfileMessage] = useState('')
  const [profileError, setProfileError] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileEditing, setProfileEditing] = useState(false)
  const [profileBeforeEdit, setProfileBeforeEdit] = useState(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [subjectPendingDelete, setSubjectPendingDelete] = useState(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [calendarEvents, setCalendarEvents] = useState([])
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarError, setCalendarError] = useState('')
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [calendarStatusSyncReady, setCalendarStatusSyncReady] = useState(false)
  const [calendarAttendance, setCalendarAttendance] = useState(() => {
    if (typeof window === 'undefined' || !session?.user?.id) return {}

    try {
      return JSON.parse(
        window.localStorage.getItem(`attendance-calendar-status-${session.user.id}`) || '{}',
      )
    } catch {
      return {}
    }
  })
  const [subjects, setSubjects] = useState([])
  const [subjectsLoading, setSubjectsLoading] = useState(true)
  const [subjectsSyncError, setSubjectsSyncError] = useState('')
  const [localSubjectsNeedImport, setLocalSubjectsNeedImport] = useState(false)
  const [subjectsImporting, setSubjectsImporting] = useState(false)
  const [subjectsExporting, setSubjectsExporting] = useState(false)
  const [subjectLoadAttempt, setSubjectLoadAttempt] = useState(0)
  const [subjectFormOpen, setSubjectFormOpen] = useState(false)
  const [form, setForm] = useState(emptySubjectForm)
  const [editingSubjectId, setEditingSubjectId] = useState(null)
  const [error, setError] = useState('')
  const [whatIf, setWhatIf] = useState({
    attended: '160',
    total: '215',
    futureAttended: '10',
    futureMissed: '2',
    target: '75',
  })
  const [currentTime, setCurrentTime] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, profile.studentName)
    }

    if (session?.user?.id && profile.studentName && !profileEditing) {
      saveProfileToSupabase(session, profile.studentName)
    }
  }, [profile.studentName, profileEditing, session])

  useEffect(() => {
    if (typeof window !== 'undefined' && !subjectsLoading && !subjectsSyncError) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(subjects))
    }
  }, [subjects, subjectsLoading, subjectsSyncError])

  useEffect(() => {
    if (!session?.user?.id) return undefined

    let active = true
    loadProfileFromSupabase(session, setProfile)
    loadSubjectsFromSupabase(session)
      .then((remoteSubjects) => {
        if (!active) return

        if (remoteSubjects.length > 0) {
          setSubjects(remoteSubjects)
          setLocalSubjectsNeedImport(false)
        } else {
          const cachedSubjects = readStoredSubjects()
          setSubjects(cachedSubjects)
          setLocalSubjectsNeedImport(cachedSubjects.length > 0)
        }
      })
      .catch((loadError) => {
        if (!active) return
        setSubjectsSyncError(
          `Could not load subjects from the database: ${loadError.message || 'unknown error'}. Check that Vercel uses the same Supabase project and that the database schema is installed.`,
        )
      })
      .finally(() => {
        if (active) setSubjectsLoading(false)
      })

    return () => {
      active = false
    }
  }, [session, subjectLoadAttempt])

  const handleProfilePhotoChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setProfileError('')
    setProfileMessage('')
    setProfileSaving(true)

    try {
      const photo = await uploadProfilePhoto(session, file)
      if (!photo) throw new Error('Profile photo upload is unavailable.')
      setProfile((current) => ({
        ...current,
        avatarPath: photo.path,
        avatarUrl: photo.url,
      }))
      setProfileMessage('Photo uploaded. Save your profile to keep this change.')
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

    if (!profile.studentName.trim()) {
      setProfileError('Please enter your name.')
      return
    }

    if (profile.universityEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.universityEmail)) {
      setProfileError('Please enter a valid university email address.')
      return
    }

    setProfileSaving(true)
    try {
      const saved = await saveExtendedProfileToSupabase(session, profile)
      if (!saved) throw new Error('Profile details could not be saved. Please try again.')
      setProfileMessage('Profile details saved.')
      setProfileBeforeEdit(null)
      setProfileEditing(false)
    } catch (saveError) {
      setProfileError(saveError.message || 'Profile details could not be saved.')
    } finally {
      setProfileSaving(false)
    }
  }

  const totalClasses = subjects.reduce((sum, subject) => sum + Number(subject.total), 0)
  const totalAttended = subjects.reduce(
    (sum, subject) => sum + Number(subject.attended),
    0,
  )
  const overallAttendance = calculatePercentage(totalAttended, totalClasses)
  const overallAttendanceTone =
    overallAttendance < 75 ? 'below' : overallAttendance === 75 ? 'target' : 'above'
  const targetPercentage = subjects.length
    ? subjects.reduce((sum, subject) => sum + Number(subject.target), 0) / subjects.length
    : 0
  const overallPlanDetails = getOverallPlanDetails(totalAttended, totalClasses, 75)
  const whatIfNumbers = Object.fromEntries(
    Object.entries(whatIf).map(([key, value]) => [key, Number(value)]),
  )
  const whatIfFieldsValid =
    Object.values(whatIf).every((value) => /^\d+$/.test(value)) &&
    whatIfNumbers.attended >= 0 &&
    whatIfNumbers.total > 0 &&
    whatIfNumbers.attended <= whatIfNumbers.total &&
    whatIfNumbers.futureAttended >= 0 &&
    whatIfNumbers.futureMissed >= 0 &&
    whatIfNumbers.target >= 0 &&
    whatIfNumbers.target <= 100

  const closeProfileEditor = (restoreChanges = true) => {
    if (restoreChanges && profileBeforeEdit) setProfile(profileBeforeEdit)
    setProfileBeforeEdit(null)
    setProfileEditing(false)
    setProfileError('')
    setProfileMessage('')
  }

  useEffect(() => {
    if (!profileEditing) return undefined

    const handleEscape = (event) => {
      if (event.key === 'Escape' && !profileSaving) {
        if (profileBeforeEdit) setProfile(profileBeforeEdit)
        setProfileBeforeEdit(null)
        setProfileEditing(false)
        setProfileError('')
        setProfileMessage('')
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [profileEditing, profileSaving, profileBeforeEdit])

  const loadCalendarEvents = useCallback(async (accessToken) => {
    const { timeMin, timeMax } = getCalendarDateRange()
    const requestOptions = {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
    const calendarListResponse = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250',
      requestOptions,
    )

    if (!calendarListResponse.ok) {
      throw new Error(
        await getGoogleApiError(
          calendarListResponse,
          'Google Calendar could not read your calendar list',
        ),
      )
    }

    const calendarList = await calendarListResponse.json()
    const calendars = calendarList.items || []
    const calendarResults = await Promise.all(
      calendars.map(async (calendar) => {
        const params = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '50',
          showDeleted: 'false',
        })
        const response = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?${params.toString()}`,
          requestOptions,
        )

        if (!response.ok) {
          return {
            events: [],
            error: await getGoogleApiError(
              response,
              `Could not read the "${calendar.summary || calendar.id}" calendar`,
            ),
          }
        }

        const data = await response.json()
        return {
          events: (data.items || []).map((event) => ({
            ...event,
            calendarId: calendar.id,
            calendarName: calendar.summary || calendar.id,
          })),
          error: '',
        }
      }),
    )

    const failedCalendars = calendarResults.filter((result) => result.error)
    const events = calendarResults
      .flatMap((result) => result.events)
      .flat()
      .sort((first, second) => {
        const firstStart = first.start?.dateTime || first.start?.date || ''
        const secondStart = second.start?.dateTime || second.start?.date || ''
        return firstStart.localeCompare(secondStart)
      })

    if (calendars.length === 0) {
      throw new Error('Google Calendar returned no calendars for this account.')
    }

    if (failedCalendars.length === calendars.length) {
      throw new Error(failedCalendars[0].error)
    }

    if (failedCalendars.length > 0 && events.length === 0) {
      throw new Error(failedCalendars[0].error)
    }

    let localStatuses = {}
    try {
      localStatuses = JSON.parse(
        window.localStorage.getItem(`attendance-calendar-status-${session.user.id}`) || '{}',
      )
    } catch {
      console.error('Could not read saved calendar attendance from this browser.')
    }

    let savedStatuses = localStatuses
    try {
      const availableSubjects = await loadSubjectsFromSupabase(session)
      const syncResult = await syncCalendarAttendanceFromSupabase(
        session,
        events,
        availableSubjects,
      )
      savedStatuses = syncResult.statuses
      setCalendarStatusSyncReady(true)
      setCalendarError(syncResult.warning)
    } catch (syncError) {
      console.error('Calendar events loaded, but attendance could not be synchronized:', syncError)
      setCalendarStatusSyncReady(false)
      setCalendarError(syncError.message || 'Calendar attendance could not be synchronized.')
    }

    setCalendarEvents(events)
    setCalendarAttendance(savedStatuses)
    setCalendarConnected(true)
  }, [session])

  useEffect(() => {
    if (!calendarConnected || !calendarEvents.length || !calendarStatusSyncReady) {
      return undefined
    }

    let active = true
    const refreshStatuses = async () => {
      if (document.visibilityState === 'hidden') return

      try {
        const [savedStatuses, savedSubjects] = await Promise.all([
          loadCalendarAttendanceStatuses(session),
          loadSubjectsFromSupabase(session),
        ])
        if (!active) return

        if (!localSubjectsNeedImport) {
          setSubjects(savedSubjects)
        }
        setCalendarAttendance((current) => {
          const next = { ...current, ...savedStatuses }
          window.localStorage.setItem(
            `attendance-calendar-status-${session.user.id}`,
            JSON.stringify(next),
          )
          return next
        })
      } catch (refreshError) {
        if (!active) return
        setCalendarStatusSyncReady(false)
        setCalendarError(refreshError.message || 'Calendar attendance could not be refreshed.')
      }
    }

    const intervalId = window.setInterval(refreshStatuses, 15_000)
    window.addEventListener('focus', refreshStatuses)
    document.addEventListener('visibilitychange', refreshStatuses)

    return () => {
      active = false
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshStatuses)
      document.removeEventListener('visibilitychange', refreshStatuses)
    }
  }, [
    calendarConnected,
    calendarEvents.length,
    calendarStatusSyncReady,
    localSubjectsNeedImport,
    session,
  ])

  const requestCalendarAccess = useCallback(async (prompt) => {
    await loadGoogleIdentityScript()

    return new Promise((resolve, reject) => {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: googleClientId,
        scope: GOOGLE_CALENDAR_SCOPE,
        callback: (tokenResponse) => {
          if (tokenResponse.error) {
            reject(
              new Error(
                tokenResponse.error_description ||
                  `Google Calendar authorization failed (${tokenResponse.error}).`,
              ),
            )
            return
          }

          if (!tokenResponse.access_token) {
            reject(new Error('Google did not return a Calendar access token. Please try again.'))
            return
          }

          const expiresAt = Date.now() + Number(tokenResponse.expires_in || 3600) * 1000
          window.localStorage.setItem(
            `attendance-calendar-token-${session.user.id}`,
            JSON.stringify({
              accessToken: tokenResponse.access_token,
              expiresAt,
            }),
          )
          resolve(tokenResponse.access_token)
        },
        error_callback: (error) => {
          const message =
            error?.type === 'popup_closed'
              ? 'Google Calendar sign-in was closed before access was granted.'
              : 'Google Calendar sign-in could not open. Check your browser popup settings and try again.'
          reject(new Error(message))
        },
      })
      tokenClient.requestAccessToken({ prompt })
    })
  }, [session])

  const connectCalendarWithPrompt = useCallback(async (prompt) => {
    const accessToken = await requestCalendarAccess(prompt)
    await loadCalendarEvents(accessToken)
    setCalendarConnected(true)
  }, [loadCalendarEvents, requestCalendarAccess])

  const handleCalendarConnect = async () => {
    setCalendarError('')

    if (!googleClientId) {
      setCalendarError('Google Calendar is not configured for this deployment.')
      return
    }

    setCalendarLoading(true)

    try {
      await connectCalendarWithPrompt('consent')
    } catch (calendarLoadError) {
      window.localStorage.removeItem(`attendance-calendar-token-${session.user.id}`)
      setCalendarConnected(false)
      setCalendarEvents([])
      setCalendarError(calendarLoadError.message || 'Could not connect Google Calendar.')
    } finally {
      setCalendarLoading(false)
    }
  }

  useEffect(() => {
    if (!session?.user?.id || !googleClientId) return

    const savedToken = window.localStorage.getItem(
      `attendance-calendar-token-${session.user.id}`,
    )
    if (!savedToken) return

    try {
      const { accessToken, expiresAt } = JSON.parse(savedToken)
      const loadPromise =
        accessToken && Number(expiresAt) > Date.now()
          ? loadCalendarEvents(accessToken)
          : connectCalendarWithPrompt('none')

      loadPromise
        .catch((calendarLoadError) => {
          window.localStorage.removeItem(`attendance-calendar-token-${session.user.id}`)
          setCalendarConnected(false)
          setCalendarEvents([])
          setCalendarError(
            calendarLoadError.message || 'Could not restore Google Calendar access.',
          )
        })
        .finally(() => setCalendarLoading(false))
    } catch {
      window.localStorage.removeItem(`attendance-calendar-token-${session.user.id}`)
    }
  }, [session, loadCalendarEvents, connectCalendarWithPrompt])

  const handleSubjectInput = (event) => {
    const { name, value } = event.target
    setForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleAddSubject = async (event) => {
    event.preventDefault()
    setError('')

    if (localSubjectsNeedImport) {
      setError('Import the saved browser subjects to your account before making changes.')
      return
    }

    const name = form.name.trim()
    const total = Number(form.total)
    const attended = Number(form.attended)
    const target = Number(form.target)

    if (!name) {
      setError('Subject name is required.')
      return
    }

    if (!form.total.trim() || !/^\d+$/.test(form.total) || !Number.isFinite(total) || total <= 0) {
      setError('Total classes must be greater than 0.')
      return
    }

    if (!form.attended.trim() || !/^\d+$/.test(form.attended) || !Number.isFinite(attended) || attended < 0) {
      setError('Attended classes cannot be negative.')
      return
    }

    if (attended > total) {
      setError('Attended classes cannot be greater than total classes.')
      return
    }

    if (
      !form.target.trim() ||
      !/^\d+(\.\d+)?$/.test(form.target) ||
      !Number.isFinite(target) ||
      target < 0 ||
      target > 100
    ) {
      setError('Target percentage must be between 0 and 100.')
      return
    }

    if (editingSubjectId) {
      if (localSubjectsNeedImport) {
        setError('Import the saved browser subjects to your account before editing them.')
        return
      }

      const currentSubject = subjects.find((subject) => subject.id === editingSubjectId)
      if (!currentSubject) {
        setError('Could not find the subject to update. Reload your subjects and try again.')
        return
      }

      const updatedSubject = {
        ...currentSubject,
        name,
        total,
        attended,
        target,
      }

      try {
        const savedSubject = await saveSubjectToSupabase(session, updatedSubject, true)
        setSubjects((current) =>
          current.map((subject) =>
            subject.id === editingSubjectId ? savedSubject : subject,
          ),
        )
        setEditingSubjectId(null)
        setForm(emptySubjectForm)
        setSubjectFormOpen(false)
      } catch (saveError) {
        setError(`Could not save this subject: ${saveError.message || 'unknown error'}`)
      }
      return
    }

    const newSubject = {
      id: Date.now(),
      name,
      total,
      attended,
      target,
    }

    try {
      const savedSubject = await saveSubjectToSupabase(session, newSubject)
      setSubjects((current) => [...current, savedSubject])
      setForm(emptySubjectForm)
      setSubjectFormOpen(false)
    } catch (saveError) {
      setError(`Could not save this subject: ${saveError.message || 'unknown error'}`)
    }
  }

  const handleImportLocalSubjects = async () => {
    setSubjectsImporting(true)
    setError('')

    try {
      const importedSubjects = await importLocalSubjectsToSupabase(session, subjects)
      setSubjects(importedSubjects)
      setLocalSubjectsNeedImport(false)
      setError('')
    } catch (importError) {
      setError(`Could not import saved subjects: ${importError.message || 'unknown error'}`)
    } finally {
      setSubjectsImporting(false)
    }
  }

  const handleMarkAttendance = async (subjectId, attended) => {
    setError('')

    if (localSubjectsNeedImport) {
      setError('Import the saved browser subjects to your account before marking attendance.')
      return false
    }

    const subject = subjects.find((item) => item.id === subjectId)
    if (!subject) {
      setError('Could not find that subject.')
      return false
    }

    const subjectEvent = calendarEvents
      .filter((event) => {
        if (isCancelledCalendarEvent(event)) return false
        const eventDate = getCalendarEventDate(event)
        const title = `${event.summary || ''} ${event.description || ''}`.toLowerCase()
        const eventStatus = getCalendarAttendanceStatus(calendarAttendance[getCalendarEventKey(event)])
        const startsToday =
          getLocalDateKey(eventDate) === getLocalDateKey(currentTime) &&
          (!eventDate || eventDate <= currentTime)
        return (
          startsToday &&
          title.includes(subject.name.toLowerCase()) &&
          !eventStatus
        )
      })
      .sort((first, second) => {
        const firstTime = getCalendarEventDate(first)?.getTime() || 0
        const secondTime = getCalendarEventDate(second)?.getTime() || 0
        return firstTime - secondTime
      })[0]

    if (!subjectEvent) {
      setError('Present or Absent is available only when an unmarked class is active in Google Calendar.')
      return false
    }

    try {
      const { data, error: markError } = await supabase.rpc('mark_calendar_attendance', {
        p_subject_id: subjectId,
        p_event_key: getCalendarEventKey(subjectEvent),
        p_status: attended ? 'present' : 'absent',
      })
      if (markError) throw markError

      const result = Array.isArray(data) ? data[0] : data
      if (!result) throw new Error('The database did not return the saved attendance.')

      const savedSubject = {
        id: result.subject_id,
        name: result.subject_name,
        total: Number(result.total_classes),
        attended: Number(result.attended_classes),
        target: Number(result.target_percentage),
      }
      setSubjects((current) =>
        current.map((item) => (item.id === subjectId ? savedSubject : item)),
      )
      if (result.inserted) {
        await saveAttendanceLogToSupabase(
          session,
          savedSubject,
          'update',
          attended ? 'Marked present' : 'Marked absent',
        )
      }

      const eventKey = getCalendarEventKey(subjectEvent)
      const savedStatus = result.attendance_status
      setCalendarStatusSyncReady(true)
      setCalendarAttendance((current) => {
        const next = { ...current, [eventKey]: savedStatus }
        window.localStorage.setItem(
          `attendance-calendar-status-${session.user.id}`,
          JSON.stringify(next),
        )
        return next
      })
    } catch (saveError) {
      const setupHint = `${saveError.message || ''}`.includes('mark_calendar_attendance')
        ? ' Run the latest supabase-schema.sql in your Supabase SQL Editor.'
        : ''
      setError(
        `Attendance was not changed because it could not be saved: ${saveError.message || 'unknown error'}.${setupHint}`,
      )
      return false
    }

    return true
  }

  const handleEditSubject = (subject) => {
    setEditingSubjectId(subject.id)
    setSubjectFormOpen(true)
    setForm({
      name: subject.name,
      total: String(subject.total),
      attended: String(subject.attended),
      target: String(subject.target),
    })
  }

  const closeSubjectForm = () => {
    setSubjectFormOpen(false)
    setEditingSubjectId(null)
    setForm(emptySubjectForm)
    setError('')
  }

  const handleDownloadSubjectsExcel = async () => {
    const exportDate = new Date()
    const studentSlug = (profile.studentName || 'student')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    setSubjectsExporting(true)
    setError('')

    try {
      const navy = '#173B70'
      const blue = '#2563EB'
      const gray = '#334155'
      const white = '#FFFFFF'
      const labelCell = (value) => ({
        value,
        fontWeight: 'bold',
        textColor: gray,
        backgroundColor: '#EAF1FA',
      })
      const textCell = (value) => ({
        value: String(value ?? ''),
        type: String,
        textColor: '#0F172A',
      })
      const rows = [
        [
          {
            value: 'ATTENDANCE TRACKER',
            columnSpan: 5,
            fontWeight: 'bold',
            fontSize: 20,
            textColor: white,
            backgroundColor: navy,
            height: 38,
          },
          null,
          null,
          null,
          null,
        ],
        [],
        [
          labelCell('Student name'),
          textCell(profile.studentName || 'Not provided'),
          labelCell('PRN'),
          { ...textCell(profile.prnNumber || 'Not provided'), format: '@' },
        ],
        [
          labelCell('Export date'),
          textCell(exportDate.toLocaleDateString()),
          labelCell('Overall attendance'),
          {
            value: overallAttendance / 100,
            format: '0.00%',
            fontWeight: 'bold',
            fontSize: 13,
            textColor: overallAttendance >= 75 ? '#166534' : '#B91C1C',
            backgroundColor: overallAttendance >= 75 ? '#DCFCE7' : '#FEE2E2',
          },
        ],
        [
          labelCell('Attended classes'),
          { value: totalAttended, format: '0' },
          labelCell('Total classes'),
          { value: totalClasses, format: '0' },
        ],
        [],
        [
          'Subject',
          'Attended classes',
          'Total classes',
          'Current attendance',
          'Status',
        ].map((value) => ({
          value,
          fontWeight: 'bold',
          fontSize: 11,
          textColor: white,
          backgroundColor: blue,
          height: 30,
          wrap: true,
        })),
      ]

      subjects.forEach((subject, index) => {
        const attendance = calculatePercentage(subject.attended, subject.total)
        const status = getStatusText(attendance, subject.target)
        const color =
          status === 'Safe'
            ? { textColor: '#166534', backgroundColor: '#DCFCE7' }
            : status === 'Warning'
              ? { textColor: '#92400E', backgroundColor: '#FEF3C7' }
              : { textColor: '#B91C1C', backgroundColor: '#FEE2E2' }
        const stripe = index % 2 === 1 ? { backgroundColor: '#F8FAFC' } : {}

        rows.push([
          { ...textCell(subject.name), ...stripe },
          { value: subject.attended, format: '0', ...stripe },
          { value: subject.total, format: '0', ...stripe },
          {
            value: attendance / 100,
            format: '0.00%',
            fontWeight: 'bold',
            ...color,
          },
          { value: status, fontWeight: 'bold', ...color },
        ])
      })

      const workbook = await writeExcelFile(rows, {
        columns: [{ width: 34 }, { width: 20 }, { width: 18 }, { width: 24 }, { width: 20 }],
      })
      const file = await workbook.toBlob()
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = `attendance-${studentSlug || 'student'}-${getLocalDateKey(exportDate)}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (exportError) {
      console.error('Failed to export attendance workbook:', exportError)
      setError(`Could not export the attendance workbook: ${exportError.message || 'unknown error'}`)
    } finally {
      setSubjectsExporting(false)
    }
  }

  const requestDeleteSubject = (subject) => {
    setSubjectPendingDelete(subject)
    setDeleteConfirmation('')
  }

  const handleDeleteSubject = async () => {
    if (!subjectPendingDelete || deleteConfirmation !== 'DELETE') {
      return
    }
    if (localSubjectsNeedImport) {
      setError('Import the saved browser subjects to your account before deleting them.')
      return
    }

    const subjectId = subjectPendingDelete.id
    setError('')
    try {
      await deleteSubjectFromSupabase(session, subjectId)
    } catch (deleteError) {
      setError(`Could not delete this subject: ${deleteError.message || 'unknown error'}`)
      return
    }

    const filtered = subjects.filter((subject) => subject.id !== subjectId)
    setSubjects(filtered)

    if (editingSubjectId === subjectId) {
      setEditingSubjectId(null)
      setForm(emptySubjectForm)
    }

    setSubjectPendingDelete(null)
    setDeleteConfirmation('')
  }

  const today = new Date()
  const todayKey = getLocalDateKey(today)
  const todayTomorrowEvents = calendarEvents.filter((event) => {
    if (isCancelledCalendarEvent(event)) return false
    const key = getLocalDateKey(getCalendarEventDate(event))
    return key === todayKey
  })
  const todayEvents = todayTomorrowEvents.filter(
    (event) => getLocalDateKey(getCalendarEventDate(event)) === todayKey,
  )
  const sortedTodayEvents = [...todayEvents].sort((first, second) => {
    const firstTime = getCalendarEventDate(first)?.getTime() || 0
    const secondTime = getCalendarEventDate(second)?.getTime() || 0
    return firstTime - secondTime
  })
  const remainingTodayEvents = sortedTodayEvents.filter(
    (event) => !getCalendarAttendanceStatus(calendarAttendance[getCalendarEventKey(event)]),
  )
  const recordedTodayCount = todayEvents.length - remainingTodayEvents.length
  const dayHasEnded =
    todayEvents.length > 0 &&
    todayEvents.every((event) => {
      const eventEnd = getCalendarEventEndDate(event)
      return eventEnd ? eventEnd <= currentTime : false
    })
  const recordedPresentCount = todayEvents.filter(
    (event) => getCalendarAttendanceStatus(calendarAttendance[getCalendarEventKey(event)]) === 'present',
  ).length
  const recordedAbsentCount = todayEvents.filter(
    (event) => getCalendarAttendanceStatus(calendarAttendance[getCalendarEventKey(event)]) === 'absent',
  ).length
  const endOfDayBaseTotal = Math.max(0, totalClasses - recordedPresentCount - recordedAbsentCount)
  const endOfDayBaseAttended = Math.max(0, totalAttended - recordedPresentCount)
  const endOfDayScenarios = Array.from({ length: todayEvents.length + 1 }, (_, attendedToday) => {
    const projectedAttendance = calculatePercentage(
      endOfDayBaseAttended + attendedToday,
      endOfDayBaseTotal + todayEvents.length,
    )
    return {
      attendedToday,
      missedToday: todayEvents.length - attendedToday,
      projectedAttendance,
    }
  })
  const todayScenarios = Array.from(
    { length: remainingTodayEvents.length + 1 },
    (_, attendedToday) => {
    const projectedAttendance = calculatePercentage(
      totalAttended + attendedToday,
      totalClasses + remainingTodayEvents.length,
    )
    const change = projectedAttendance - overallAttendance
    return {
      attendedToday,
      projectedAttendance,
      change,
      decision:
        projectedAttendance >= 75
          ? attendedToday === 0
            ? remainingTodayEvents.length === 0
              ? 'All of today’s classes are recorded'
              : `Miss all ${remainingTodayEvents.length} remaining class${remainingTodayEvents.length === 1 ? '' : 'es'}`
            : `Attend ${attendedToday} of ${remainingTodayEvents.length} remaining class${remainingTodayEvents.length === 1 ? '' : 'es'}`
          : attendedToday === 0
            ? remainingTodayEvents.length === 0
              ? 'Today’s classes are recorded'
              : `Miss all ${remainingTodayEvents.length} remaining class${remainingTodayEvents.length === 1 ? '' : 'es'} — below 75%`
            : `Attend ${attendedToday} of ${remainingTodayEvents.length} remaining class${remainingTodayEvents.length === 1 ? '' : 'es'} — still below 75%`,
    }
    },
  )

  const renderCalendarEvent = (event, eventIndex, showRecommendation) => {
    const eventDate = getCalendarEventDate(event)
    const eventEndDate = getCalendarEventEndDate(event)
    const eventStatus = getCalendarAttendanceStatus(
      calendarAttendance[getCalendarEventKey(event)],
    )
    const now = currentTime
    const isCompleted = eventEndDate && eventEndDate <= now
    const isInProgress = eventDate && eventEndDate && eventDate <= now && eventEndDate > now
    const classDuration = eventDate && eventEndDate ? eventEndDate.getTime() - eventDate.getTime() : 0
    const elapsed = eventDate ? now.getTime() - eventDate.getTime() : 0
    const progress = classDuration > 0
      ? Math.min(100, Math.max(0, (elapsed / classDuration) * 100))
      : 0
    const remainingMinutes = isInProgress
      ? Math.max(0, Math.ceil((eventEndDate.getTime() - now.getTime()) / 60000))
      : 0
    const classesBefore = sortedTodayEvents
      .slice(0, eventIndex)
      .filter((item) => !calendarAttendance[getCalendarEventKey(item)]).length
    const remainingClassNumber = classesBefore + 1
    const attendPercentage = eventStatus
      ? overallAttendance
      : calculatePercentage(
          totalAttended + classesBefore + 1,
          totalClasses + classesBefore + 1,
        )
    const leavePercentage = eventStatus
      ? overallAttendance
      : calculatePercentage(
          totalAttended + classesBefore,
          totalClasses + classesBefore + 1,
        )
    const attendChange = attendPercentage - overallAttendance
    const leaveChange = leavePercentage - overallAttendance

    return (
      <article
        className={`calendar-event ${eventStatus ? `calendar-event-${eventStatus}` : ''}`}
        key={`${event.calendarName}-${event.id}`}
      >
        <div className="calendar-event-time">
          <strong>{getCalendarDayLabel(eventDate)}</strong>
          <span>
            {eventDate && event.start?.dateTime
              ? `${eventDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${
                  eventEndDate?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) || '—'
                }`
              : 'All day'}
          </span>
          <small>
            {eventStatus === 'present'
              ? 'Present'
              : eventStatus === 'absent'
                ? 'Absent'
                : isInProgress
                  ? 'In progress'
                  : isCompleted
                    ? 'Completed'
                    : 'Upcoming'}
          </small>
          {isInProgress && (
            <span className="class-countdown">
              {remainingMinutes >= 60
                ? `${Math.floor(remainingMinutes / 60)}h ${remainingMinutes % 60}m left`
                : `${remainingMinutes}m left`}
            </span>
          )}
        </div>
        <div className="calendar-event-details">
          <strong>{event.summary || 'Untitled event'}</strong>
          <span>{event.calendarName}</span>
          {event.location && <span>{event.location}</span>}
          {isInProgress && (
            <div
              className={`class-progress ${eventStatus ? `class-progress-${eventStatus}` : ''}`}
              aria-label={`${Math.round(progress)}% of class completed`}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
          )}
          {showRecommendation && (
            <div
              className={`calendar-advice ${
                eventStatus
                  ? eventStatus === 'present'
                    ? 'safe'
                    : 'need'
                  : leavePercentage >= 75
                    ? 'safe'
                    : 'need'
              }`}
            >
              <strong className="calendar-recommendation">
                {eventStatus
                  ? eventStatus === 'present'
                    ? 'Already marked present'
                    : 'Already marked absent'
                  : `Class ${remainingClassNumber} of ${remainingTodayEvents.length} remaining`}
              </strong>
              <span>
                {eventStatus
                  ? `Current overall attendance: ${overallAttendance.toFixed(2)}%`
                  : `Attend: ${attendPercentage.toFixed(2)}% (${attendChange >= 0 ? '+' : ''}
                    ${attendChange.toFixed(2)} points) · Miss: ${leavePercentage.toFixed(2)}% (
                    ${leaveChange >= 0 ? '+' : ''}
                    ${leaveChange.toFixed(2)} points)`}
              </span>
            </div>
          )}
        </div>
      </article>
    )
  }

  const getSubjectAttendanceActionState = (subject) => {
    const matchingEvents = calendarEvents
      .filter((event) => {
        if (isCancelledCalendarEvent(event)) return false
        const eventDate = getCalendarEventDate(event)
        const title = `${event.summary || ''} ${event.description || ''}`.toLowerCase()
        return (
          getLocalDateKey(eventDate) === getLocalDateKey(currentTime) &&
          title.includes(subject.name.toLowerCase())
        )
      })
      .sort((first, second) => {
        const firstTime = getCalendarEventDate(first)?.getTime() || 0
        const secondTime = getCalendarEventDate(second)?.getTime() || 0
        return firstTime - secondTime
      })

    const activeEvent = matchingEvents.find((event) => {
      const status = getCalendarAttendanceStatus(calendarAttendance[getCalendarEventKey(event)])
      const start = getCalendarEventDate(event)
      return !status && (!start || start <= currentTime)
    })

    return {
      available: Boolean(activeEvent),
      message: activeEvent
        ? 'Mark the active Google Calendar class'
        : 'Available when the next matching calendar class starts',
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
                    setProfileBeforeEdit(profile)
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
          <div className={`metric-card highlight overall-card ${overallAttendanceTone}`}>
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

        <section className="panel calendar-panel">
          <div className="calendar-header">
            <div>
              <p className="panel-kicker">Schedule</p>
              <h2>Today’s classes</h2>
              <p className="section-help">
                {today.toLocaleDateString([], {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
                {' · '}
                Cancelled classes are not counted.
              </p>
            </div>
            <button
              type="button"
              className="primary-button calendar-connect-button"
              onClick={handleCalendarConnect}
              disabled={calendarLoading}
            >
              {calendarLoading
                ? 'Connecting...'
                : calendarConnected
                  ? 'Refresh calendar'
                  : 'Connect Google Calendar'}
            </button>
          </div>

          {calendarError && (
            <div className="feedback error" role="alert">
              {calendarError}
              {calendarError.toLowerCase().includes('origin_mismatch') && (
                <p className="oauth-origin-help">
                  Add this exact origin under Google Cloud → OAuth client → Authorized
                  JavaScript origins: <code>{window.location.origin}</code>
                  <br />
                  This app is using OAuth client ID starting with{' '}
                  <code>{googleClientId ? googleClientId.slice(0, 18) : 'not configured'}</code>.
                  Make sure it matches the client ID on the Google Cloud page you edited.
                </p>
              )}
            </div>
          )}

          {calendarConnected && calendarEvents.length === 0 && (
            <div className="info-box">
              <strong>No classes found</strong>
              <p>No Google Calendar events were found for the next five days.</p>
            </div>
          )}

          {calendarConnected && calendarEvents.length > 0 && todayTomorrowEvents.length === 0 && (
            <div className="info-box">
              <strong>Calendar connected successfully</strong>
              <p>
                {calendarEvents.length} event{calendarEvents.length === 1 ? '' : 's'} loaded, but no valid
                class is scheduled for today. Cancelled events are excluded.
              </p>
            </div>
          )}

          {calendarConnected && (todayTomorrowEvents.length > 0 || todayEvents.length === 0) && (
            <div className="calendar-layout">
              <div className="calendar-day-group">
                <h3>Attend or leave guidance</h3>
                {todayTomorrowEvents.length > 0 ? (
                  <div className="calendar-events">
                    {sortedTodayEvents.map((event, index) => renderCalendarEvent(event, index, true))}
                  </div>
                ) : (
                  <p className="section-help">No valid classes are scheduled for today.</p>
                )}
              </div>
              <div className="today-plan-card">
                <p className="panel-kicker">Today’s decision</p>
                <h3>What if I attend today?</h3>
                {todayEvents.length === 0 ? (
                  <p className="section-help">No valid classes today. Cancelled classes are not counted.</p>
                ) : (
                  <>
                    <p className="today-plan-meta">
                      {recordedTodayCount > 0
                        ? `${recordedTodayCount} recorded · ${remainingTodayEvents.length} remaining · projections use only remaining classes`
                        : `${todayEvents.length} valid class${todayEvents.length === 1 ? '' : 'es'}`}
                      {' · '}cancelled classes excluded
                    </p>
                    <div className="today-scenarios">
                      {todayScenarios.map((scenario) => (
                        <div
                          className={`today-scenario ${
                            scenario.projectedAttendance >= 75 ? 'safe' : 'need'
                          }`}
                          key={scenario.attendedToday}
                        >
                          <strong>{scenario.decision}</strong>
                          <span>
                            Overall: {scenario.projectedAttendance.toFixed(2)}% (
                            {scenario.change >= 0 ? '+' : ''}
                            {scenario.change.toFixed(2)} points)
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {dayHasEnded && (
                  <div className="end-of-day-review">
                    <p className="panel-kicker">End-of-day review</p>
                    <h3>What today could have looked like</h3>
                    <p className="today-plan-meta">
                      Based on {todayEvents.length} completed class{todayEvents.length === 1 ? '' : 'es'}.
                      This is a review only and does not change your records.
                    </p>
                    <div className="end-of-day-scenarios">
                      {endOfDayScenarios.map((scenario) => (
                        <div
                          className={`end-of-day-scenario ${
                            scenario.projectedAttendance >= 75 ? 'safe' : 'need'
                          }`}
                          key={scenario.attendedToday}
                        >
                          <strong>
                            Attend {scenario.attendedToday}, miss {scenario.missedToday}
                          </strong>
                          <span>Overall would be {scenario.projectedAttendance.toFixed(2)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

        </section>

        {subjectsLoading && (
          <div className="info-box">
            <p>Loading your subjects from your account...</p>
          </div>
        )}
        {subjectsSyncError && (
          <div className="feedback error" role="alert">
            <p>{subjectsSyncError}</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setSubjectsSyncError('')
                setSubjectsLoading(true)
                setSubjectLoadAttempt((attempt) => attempt + 1)
              }}
              disabled={subjectsLoading}
            >
              {subjectsLoading ? 'Retrying...' : 'Retry loading'}
            </button>
          </div>
        )}
        {localSubjectsNeedImport && (
          <div className="info-box">
            <h3>Saved subjects found in this browser</h3>
            <p>
              Your account has no subjects in the database yet, but this browser has {subjects.length}{' '}
              saved subject{subjects.length === 1 ? '' : 's'}. Import them only if they belong to the
              account you are signed into.
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={handleImportLocalSubjects}
              disabled={subjectsImporting}
            >
              {subjectsImporting ? 'Importing subjects...' : 'Import saved subjects to my account'}
            </button>
          </div>
        )}

        {subjectFormOpen && (
          <div
            className="profile-modal-backdrop subject-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeSubjectForm()
            }}
          >
            <section
              className="profile-modal subject-modal"
              id="subject-form-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="subject-modal-title"
            >
              <div className="profile-modal-header">
                <div>
                  <p className="panel-kicker">{editingSubjectId ? 'Update details' : 'New subject'}</p>
                  <h2 id="subject-modal-title">{editingSubjectId ? 'Edit subject' : 'Add a subject'}</h2>
                  <p>Enter your class totals and target. Attendance percentage is calculated automatically.</p>
                </div>
                <button
                  type="button"
                  className="profile-modal-close"
                  aria-label="Close subject form"
                  onClick={closeSubjectForm}
                >
                  ×
                </button>
              </div>

              <form onSubmit={handleAddSubject} className="subject-form subject-modal-form">
                <label>
                  <span>Subject name</span>
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleSubjectInput}
                    placeholder="Business Statistics"
                    autoFocus
                  />
                </label>

                <div className="two-column">
                  <label>
                    <span>Total classes</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      name="total"
                      value={form.total}
                      onChange={handleSubjectInput}
                      placeholder="12"
                    />
                  </label>

                  <label>
                    <span>Attended classes</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      name="attended"
                      value={form.attended}
                      onChange={handleSubjectInput}
                      placeholder="8"
                    />
                  </label>
                </div>

                <label>
                  <span>Target percentage</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    name="target"
                    value={form.target}
                    onChange={handleSubjectInput}
                    placeholder="75"
                  />
                </label>

                {error && <div className="feedback error">{error}</div>}

                <div className="form-actions subject-modal-actions">
                  <button type="submit" className="primary-button">
                    {editingSubjectId ? 'Update subject' : 'Save subject'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button button-ghost"
                    onClick={closeSubjectForm}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

        <section className="content-grid plan-grid">
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

        {error && !subjectFormOpen && (
          <div className="feedback error subject-action-error" role="alert">
            {error}
          </div>
        )}

        <section className="panel table-panel">
          <div className="subject-table-heading">
            <div>
              <p className="panel-kicker">Your attendance records</p>
              <h2>Subject table</h2>
              <p className="section-help">
                Mark attendance from scheduled classes, edit subject details, or export your report.
              </p>
            </div>
            <div className="subject-table-actions">
              <button
                type="button"
                className="secondary-button export-button"
                onClick={handleDownloadSubjectsExcel}
                disabled={subjects.length === 0 || subjectsExporting}
                title={subjects.length === 0 ? 'Add a subject before exporting' : 'Download a formatted Excel attendance report'}
              >
                {subjectsExporting ? 'Preparing Excel...' : 'Download Excel'}
              </button>
              <button
                type="button"
                className="primary-button add-subject-button"
                aria-expanded={subjectFormOpen}
                aria-controls="subject-form-panel"
                onClick={() => {
                  setEditingSubjectId(null)
                  setForm(emptySubjectForm)
                  setError('')
                  setSubjectFormOpen((open) => !open)
                }}
              >
                {subjectFormOpen && !editingSubjectId ? 'Close form' : '+ Add subject'}
              </button>
            </div>
          </div>
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
                      <td data-label="Subject">{subject.name}</td>
                      <td data-label="Attended">{subject.attended}</td>
                      <td data-label="Total">{subject.total}</td>
                      <td data-label="Attendance">{percentage.toFixed(2)}%</td>
                      <td data-label="Target">{subject.target}%</td>
                      <td data-label="Status">
                        <span
                          className={`status-badge ${status.toLowerCase().replace(/\s+/g, '-')}`}
                        >
                          {status}
                        </span>
                      </td>
                      <td data-label="Actions">
                        <div className="row-actions">
                          {(() => {
                            const actionState = getSubjectAttendanceActionState(subject)
                            return (
                              <>
                          <button
                            type="button"
                            className="small-button present-button"
                            onClick={() => handleMarkAttendance(subject.id, true)}
                            disabled={!actionState.available}
                            title={actionState.message}
                          >
                            Present
                          </button>
                          <button
                            type="button"
                            className="small-button absent-button"
                            onClick={() => handleMarkAttendance(subject.id, false)}
                            disabled={!actionState.available}
                            title={actionState.message}
                          >
                            Absent
                          </button>
                              </>
                            )
                          })()}
                          <button type="button" className="small-button" onClick={() => handleEditSubject(subject)}>
                            Edit
                          </button>
                          <button type="button" className="small-button danger" onClick={() => requestDeleteSubject(subject)}>
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

        <section className="panel whatif-panel">
          <h2>What-if Calculator</h2>

          <div className="whatif-grid">
            <label>
              <span>Current attended</span>
              <input
                type="text"
                inputMode="numeric"
                value={whatIf.attended}
                onChange={(event) =>
                  setWhatIf((current) => ({
                    ...current,
                    attended: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>Current total</span>
              <input
                type="text"
                inputMode="numeric"
                value={whatIf.total}
                onChange={(event) =>
                  setWhatIf((current) => ({
                    ...current,
                    total: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>Future classes attended</span>
              <input
                type="text"
                inputMode="numeric"
                value={whatIf.futureAttended}
                onChange={(event) =>
                  setWhatIf((current) => ({
                    ...current,
                    futureAttended: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>Future classes missed</span>
              <input
                type="text"
                inputMode="numeric"
                value={whatIf.futureMissed}
                onChange={(event) =>
                  setWhatIf((current) => ({
                    ...current,
                    futureMissed: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>Target attendance</span>
              <input
                type="text"
                inputMode="numeric"
                value={whatIf.target}
                onChange={(event) =>
                  setWhatIf((current) => ({
                    ...current,
                    target: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          {!whatIfFieldsValid && (
            <div className="feedback error whatif-validation" role="status">
              Enter whole-number values, keep attended classes at or below total, and set the target
              between 0% and 100%.
            </div>
          )}

          <div className="whatif-results">
            <div>
              <span>Future attendance %</span>
              <strong className={!whatIfFieldsValid ? 'result-placeholder' : ''}>
                {whatIfFieldsValid
                  ? `${getFutureAttendance(
                      whatIfNumbers.attended,
                      whatIfNumbers.total,
                      whatIfNumbers.futureAttended,
                      whatIfNumbers.futureMissed,
                    ).toFixed(2)}%`
                  : '—'}
              </strong>
            </div>

            <div>
              <span>Classes required</span>
              <strong className={!whatIfFieldsValid ? 'result-placeholder' : ''}>
                {whatIfFieldsValid
                  ? (() => {
                      const required = getClassesRequired(
                        whatIfNumbers.attended + whatIfNumbers.futureAttended,
                        whatIfNumbers.total +
                          whatIfNumbers.futureAttended +
                          whatIfNumbers.futureMissed,
                        whatIfNumbers.target,
                      )
                      return required === null ? 'Not attainable' : required
                    })()
                  : '—'}
              </strong>
            </div>

            <div>
              <span>Classes can be missed</span>
              <strong className={!whatIfFieldsValid ? 'result-placeholder' : ''}>
                {whatIfFieldsValid
                  ? getClassesMissed(
                      whatIfNumbers.attended + whatIfNumbers.futureAttended,
                      whatIfNumbers.total +
                        whatIfNumbers.futureAttended +
                        whatIfNumbers.futureMissed,
                      whatIfNumbers.target,
                    )
                  : '—'}
              </strong>
            </div>

            <div>
              <span>Target achieved</span>
              <strong className={!whatIfFieldsValid ? 'result-placeholder' : ''}>
                {whatIfFieldsValid
                  ? getFutureAttendance(
                      whatIfNumbers.attended,
                      whatIfNumbers.total,
                      whatIfNumbers.futureAttended,
                      whatIfNumbers.futureMissed,
                    ) >= whatIfNumbers.target
                    ? 'Yes'
                    : 'No'
                  : '—'}
              </strong>
            </div>
          </div>
        </section>
        {profileEditing && (
          <div
            className="profile-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !profileSaving) closeProfileEditor()
            }}
          >
            <section
              className="profile-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="profile-modal-title"
            >
              <div className="profile-modal-header">
                <div>
                  <p className="panel-kicker">Personal details</p>
                  <h2 id="profile-modal-title">Update your profile</h2>
                  <p>Keep your student information current for your attendance reports.</p>
                </div>
                <button
                  type="button"
                  className="profile-modal-close"
                  aria-label="Close profile editor"
                  onClick={() => closeProfileEditor()}
                  disabled={profileSaving}
                >
                  ×
                </button>
              </div>

              <div className="profile-modal-avatar-row">
                <div className="avatar-preview">
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="Profile" />
                  ) : (
                    <span>{profile.studentName.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <label className="small-button upload-button">
                  {profileSaving ? 'Uploading...' : 'Change photo'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleProfilePhotoChange}
                    disabled={profileSaving}
                  />
                </label>
              </div>

              <form className="profile-form profile-modal-form" onSubmit={handleProfileSave}>
                <label>
                  <span>Student name</span>
                  <input
                    type="text"
                    value={profile.studentName}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, studentName: event.target.value }))
                    }
                    autoComplete="name"
                  />
                </label>
                <label>
                  <span>PRN number</span>
                  <input
                    type="text"
                    value={profile.prnNumber}
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
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, universityEmail: event.target.value }))
                    }
                    placeholder="student@university.ac.in"
                    autoComplete="email"
                  />
                </label>
                {profileError && <div className="feedback error">{profileError}</div>}
                {profileMessage && <div className="feedback success">{profileMessage}</div>}
                <div className="form-actions profile-modal-actions">
                  <button type="submit" className="primary-button" disabled={profileSaving}>
                    {profileSaving ? 'Saving...' : 'Save profile'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button button-ghost"
                    onClick={() => closeProfileEditor()}
                    disabled={profileSaving}
                  >
                    Close
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

        {subjectPendingDelete && (
          <div className="confirm-backdrop" role="presentation">
            <section
              className="confirm-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-subject-title"
            >
              <p className="panel-kicker">Permanent action</p>
              <h2 id="delete-subject-title">Delete {subjectPendingDelete.name}?</h2>
              <p>
                This removes the subject and its attendance data. Type <strong>DELETE</strong> to
                confirm.
              </p>
              <input
                type="text"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                placeholder="Type DELETE"
                autoFocus
              />
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary-button button-ghost"
                  onClick={() => {
                    setSubjectPendingDelete(null)
                    setDeleteConfirmation('')
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="small-button danger confirm-delete-button"
                  onClick={handleDeleteSubject}
                  disabled={deleteConfirmation !== 'DELETE'}
                >
                  Confirm delete
                </button>
              </div>
            </section>
          </div>
        )}
        <footer className="app-footer">Developed by Sushank Sah · © 2026</footer>
      </div>
    </main>
  )
}

function PasswordRecovery({ onComplete }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Choose a password with at least 8 characters.')
      return
    }
    if (password !== confirmation) {
      setError('The passwords do not match.')
      return
    }

    setSaving(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSaving(false)

    if (updateError) {
      setError(`Could not update your password: ${updateError.message}`)
      return
    }

    onComplete()
  }

  return (
    <main className="app-shell auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Account security</p>
        <h1>Choose a new password</h1>
        <p>Enter a new password for your Attendance Tracker account.</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <label>
            <span>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
            />
          </label>
          {error && <div className="feedback error" role="alert">{error}</div>}
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? 'Saving password…' : 'Save new password'}
          </button>
        </form>
      </section>
    </main>
  )
}

function AuthScreen() {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState(emptyAuthForm)
  const [session, setSession] = useState(null)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [authLoading, setAuthLoading] = useState(Boolean(supabase))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!supabase) return undefined

    let active = true

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (active) {
        if (event === 'PASSWORD_RECOVERY') {
          setPasswordRecovery(true)
        }
        setSession(newSession)
        setAuthLoading(false)
      }
    })

    supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active) return
        if (sessionError) {
          setError(`Could not restore your sign-in session: ${sessionError.message}`)
        }
        setSession(data.session)
        setAuthLoading(false)
      })
      .catch((sessionError) => {
        if (!active) return
        setError(
          `Could not restore your sign-in session: ${sessionError.message || 'Please check your connection and reload.'}`,
        )
        setAuthLoading(false)
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
    if (passwordRecovery) {
      return <PasswordRecovery onComplete={() => setPasswordRecovery(false)} />
    }
    return <Dashboard session={session} onLogout={handleLogout} />
  }

  if (authLoading) {
    return (
      <main className="app-shell auth-shell">
        <section className="auth-card session-loading" aria-live="polite">
          <p className="eyebrow">Secure sign-in</p>
          <h1>Restoring your session</h1>
          <p>Your private attendance dashboard will open in a moment.</p>
          <div className="session-loading-bar" aria-hidden="true" />
        </section>
      </main>
    )
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
          redirectTo: window.location.origin,
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
