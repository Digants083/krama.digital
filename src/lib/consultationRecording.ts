export type ConsultationPatient = {
  id?: string;
  name: string;
  token?: string;
  phone?: string;
  email?: string;
  clinicId?: string;
  doctorId?: string;
  appointmentId?: number;
};

export type ConsultationRecording = {
  blob: Blob;
  durationSeconds: number;
  patient: ConsultationPatient;
  recordedAt: string;
};

let currentRecording: ConsultationRecording | null = null;

export function saveConsultationRecording(recording: ConsultationRecording) {
  currentRecording = recording;
}

export function getConsultationRecording() {
  return currentRecording;
}

export function clearConsultationRecording() {
  currentRecording = null;
}
