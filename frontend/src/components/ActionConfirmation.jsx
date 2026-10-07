import Modal from './Modal';

/** Offers cancellable review before a write and an acknowledgement after persisted success. */
export default function ActionConfirmation({ action, busy, error, success, onConfirm, onClose }) {
  // An in-flight write cannot be cancelled after the server has started processing it.
  function dismiss() {
    if (!busy) onClose();
  }

  return (
    <Modal title={success ? 'Action completed' : `Confirm ${action}`} onClose={dismiss}>
      <div className="confirmation-content">
        {success ? <>
          <p role="status">{success}</p>
          <button className="button-primary" onClick={onClose}>Continue</button>
        </> : <>
          <p>Are you sure you want to {action}?</p>
          {error && <p role="alert">{error}</p>}
          <div className="form-actions">
            <button className="button-secondary" disabled={busy} onClick={onClose}>Cancel</button>
            <button className="button-primary" disabled={busy} onClick={onConfirm}>{busy ? 'Saving…' : 'Confirm'}</button>
          </div>
        </>}
      </div>
    </Modal>
  );
}
