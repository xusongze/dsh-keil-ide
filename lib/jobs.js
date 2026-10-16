/**
 * dsh-keil-ide — in-memory job model for long build/flash operations.
 * The client starts a job and polls /dsh-ide/job?id= for status + output.
 */
const jobs = new Map();
let seq = 0;

export function createJob(kind, meta = {}) {
  const id = ++seq;
  const job = {
    id,
    kind,
    meta,
    status: 'running', // running | done | error
    output: '',
    exitCode: null,
    startedAt: Date.now(),
    endedAt: null,
    error: null,
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id) {
  return jobs.get(id);
}

export function jobView(job) {
  if (!job) return null;
  const view = {
    id: job.id,
    kind: job.kind,
    meta: job.meta,
    status: job.status,
    output: job.output.slice(-200000), // cap the polled payload
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    error: job.error,
  };
  if (job.status === 'done' && typeof job.diagnose === 'function') {
    view.diagnostics = job.diagnose(job.output);
  }
  return view;
}

export function listJobs() {
  return [...jobs.values()].map((j) => ({
    id: j.id, kind: j.kind, status: j.status, exitCode: j.exitCode, startedAt: j.startedAt, endedAt: j.endedAt,
  }));
}

/** Drop finished jobs older than `maxAgeMs`. */
export function pruneJobs(maxAgeMs = 10 * 60 * 1000) {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.endedAt && now - job.endedAt > maxAgeMs) jobs.delete(id);
  }
}
