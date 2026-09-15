import { useEffect, useMemo, useState } from 'react';
import { fetchJobs, createJob, updateJobStatus, deleteJob } from './api';

const STATUSES = ['pending', 'running', 'completed', 'failed'];
const JOB_TYPES = ['email', 'report', 'data-sync', 'image-processing', 'other'];

// Mirrors the backend's transition rules, purely for UI affordances
// (which buttons to show). The backend is the source of truth and
// re-validates every request independently.
const NEXT_STATUSES = {
  pending: ['running'],
  running: ['completed', 'failed'],
  completed: [],
  failed: [],
};

function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

function NewJobForm({ onCreate, creating }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState(JOB_TYPES[0]);
  const [formError, setFormError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!title.trim()) {
      setFormError('Title is required.');
      return;
    }
    try {
      await onCreate({ title: title.trim(), type });
      setTitle('');
      setType(JOB_TYPES[0]);
    } catch (err) {
      setFormError(err.message);
    }
  };

  return (
    <form className="new-job-form" onSubmit={submit}>
      <input
        type="text"
        placeholder="Job title (e.g. Send weekly report)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={creating}
      />
      <select value={type} onChange={(e) => setType(e.target.value)} disabled={creating}>
        {JOB_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button type="submit" disabled={creating}>
        {creating ? 'Creating…' : '+ Create Job'}
      </button>
      {formError && <span className="form-error">{formError}</span>}
    </form>
  );
}

function JobRow({ job, onChangeStatus, onDelete, busy }) {
  const nextOptions = NEXT_STATUSES[job.status] || [];
  return (
    <tr className={busy ? 'row-busy' : ''}>
      <td>{job.title}</td>
      <td>{job.type}</td>
      <td>
        <StatusBadge status={job.status} />
      </td>
      <td>{new Date(job.createdAt).toLocaleString()}</td>
      <td className="actions">
        {nextOptions.map((next) => (
          <button
            key={next}
            className={`btn-status btn-${next}`}
            disabled={busy}
            onClick={() => onChangeStatus(job.id, next)}
          >
            Mark {next}
          </button>
        ))}
        {nextOptions.length === 0 && <span className="terminal-note">terminal</span>}
        <button className="btn-delete" disabled={busy} onClick={() => onDelete(job.id)}>
          Delete
        </button>
      </td>
    </tr>
  );
}

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [busyIds, setBusyIds] = useState({});
  const [actionError, setActionError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJobs();
      setJobs(data);
    } catch (err) {
      setError(err.message || 'Failed to load jobs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const counts = useMemo(() => {
    const base = { pending: 0, running: 0, completed: 0, failed: 0 };
    for (const job of jobs) {
      if (base[job.status] !== undefined) base[job.status] += 1;
    }
    return base;
  }, [jobs]);

  const visibleJobs = useMemo(() => {
    if (filter === 'all') return jobs;
    return jobs.filter((j) => j.status === filter);
  }, [jobs, filter]);

  const setBusy = (id, value) =>
    setBusyIds((prev) => ({ ...prev, [id]: value }));

  const handleCreate = async (payload) => {
    setCreating(true);
    try {
      const job = await createJob(payload);
      setJobs((prev) => [job, ...prev]);
    } finally {
      setCreating(false);
    }
  };

  const handleChangeStatus = async (id, nextStatus) => {
    setActionError(null);
    setBusy(id, true);
    try {
      const updated = await updateJobStatus(id, nextStatus);
      setJobs((prev) => prev.map((j) => (j.id === id ? updated : j)));
    } catch (err) {
      // A 409 here means another request (e.g. another browser tab)
      // already changed this job's status - refresh from the server
      // so the UI reflects reality instead of silently retrying.
      setActionError(err.message);
      await load();
    } finally {
      setBusy(id, false);
    }
  };

  const handleDelete = async (id) => {
    setActionError(null);
    setBusy(id, true);
    try {
      await deleteJob(id);
      setJobs((prev) => prev.filter((j) => j.id !== id));
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(id, false);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>Job Queue Dashboard</h1>
        <button className="btn-refresh" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <section className="counts">
        {STATUSES.map((s) => (
          <div key={s} className={`count-card count-${s}`}>
            <div className="count-number">{counts[s]}</div>
            <div className="count-label">{s}</div>
          </div>
        ))}
      </section>

      <NewJobForm onCreate={handleCreate} creating={creating} />

      <div className="filter-bar">
        <label>Filter by status:</label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {actionError && <div className="banner banner-error">{actionError}</div>}

      {loading && <div className="banner banner-info">Loading jobs…</div>}
      {!loading && error && (
        <div className="banner banner-error">
          Could not load jobs: {error}{' '}
          <button onClick={load}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <table className="jobs-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleJobs.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-row">
                  No jobs {filter !== 'all' ? `with status "${filter}"` : ''} yet.
                </td>
              </tr>
            )}
            {visibleJobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                busy={!!busyIds[job.id]}
                onChangeStatus={handleChangeStatus}
                onDelete={handleDelete}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
