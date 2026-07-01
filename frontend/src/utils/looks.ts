import api from '../config/api';

// Save a creation to the user's "Saved Creations". Idempotent server-side.
// Returns true on success. Callers handle the guest gate before calling.
export async function saveLook(jobId: string): Promise<boolean> {
  try {
    await api.post(`/looks/${jobId}`);
    return true;
  } catch {
    return false;
  }
}

export async function unsaveLook(jobId: string): Promise<boolean> {
  try {
    await api.delete(`/looks/${jobId}`);
    return true;
  } catch {
    return false;
  }
}
