/** Explicit transfer and QA status models with allowed transitions. */
export const TRANSFER_STATUSES = ['PENDING', 'RUNNING', 'RETRYING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

/**
 * QA statuses:
 *  NOT_REQUESTED - QA validation not enabled for this run
 *  NOT_STARTED   - enabled; waiting for a successful transfer / trigger, or trigger could not be sent
 *  PENDING       - QA Agent accepted the request; result not yet available
 *  RUNNING       - QA Agent reports the verification is running
 *  SUCCESS / FAILED - verdict returned by QA Agent
 *  ERROR         - QA Agent unavailable, contract mismatch, or polling limit reached
 *  SKIPPED       - transfer did not succeed, so there is nothing to verify
 */
export const QA_STATUSES = ['NOT_REQUESTED', 'NOT_STARTED', 'PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'ERROR', 'SKIPPED'] as const;
export type QaStatus = (typeof QA_STATUSES)[number];

export const READBACK_STATUSES = ['NOT_CONFIGURED', 'NOT_APPLICABLE', 'VERIFIED', 'MISMATCH', 'FAILED'] as const;
export type ReadBackStatus = (typeof READBACK_STATUSES)[number];

const TRANSITIONS: Record<TransferStatus, TransferStatus[]> = {
  PENDING: ['RUNNING', 'CANCELLED', 'FAILED'],
  RUNNING: ['SUCCESS', 'FAILED', 'TIMEOUT', 'RETRYING', 'CANCELLED'],
  RETRYING: ['RUNNING', 'CANCELLED'],
  SUCCESS: [],
  FAILED: [],
  TIMEOUT: [],
  CANCELLED: [],
};

export function canTransition(from: TransferStatus, to: TransferStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: TransferStatus, to: TransferStatus): void {
  if (!canTransition(from, to)) throw new Error(`Illegal transfer status transition ${from} -> ${to}`);
}

export const TERMINAL_TRANSFER: TransferStatus[] = ['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED'];
export const TERMINAL_QA: QaStatus[] = ['NOT_REQUESTED', 'SUCCESS', 'FAILED', 'ERROR', 'SKIPPED'];
