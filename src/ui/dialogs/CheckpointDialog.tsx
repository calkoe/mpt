/**
 * Checkpoint-Verlauf. Zeigt die letzten 50 Snapshots und stellt sie wieder her.
 * Vor jeder Wiederherstellung wird der aktuelle Stand selbst als Checkpoint
 * gesichert - man kann also auch die Wiederherstellung rückgängig machen.
 */
import { useState } from 'react';
import { describeCheckpoint, formatCheckpointTime, pushCheckpoint, restoreCheckpoint } from '../../persistence/checkpoints';
import { MAX_CHECKPOINTS } from '../../model/types';
import { useStore } from '../../state/store';
import { Button, EmptyState, Modal } from '../components/controls';
import { formatShortcut, SHORTCUTS } from '../shortcuts';

export function CheckpointDialog({ onClose }: { onClose: () => void }) {
  const { db, replaceDatabase } = useStore();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <Modal
      title={`Verlauf (${db.checkpoints.length}/${MAX_CHECKPOINTS} Checkpoints)`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="faint grow" style={{ fontSize: 'var(--fs-sm)' }}>
            Automatisch bei Änderungen, höchstens alle 10 Minuten. Für einzelne Schritte: {formatShortcut(SHORTCUTS.undo)}.
          </span>
          <Button
            onClick={() => {
              replaceDatabase(pushCheckpoint(db, 'Manuell gesetzt'), { dirty: true });
              onClose();
            }}
          >
            Checkpoint jetzt setzen
          </Button>
        </>
      }
    >
      {db.checkpoints.length === 0 ? (
        <EmptyState
          title="Noch keine Checkpoints"
          hint="Sobald du etwas änderst, wird automatisch ein Snapshot abgelegt."
        />
      ) : (
        <div className="list">
          {db.checkpoints.map((cp, index) => (
            <div key={cp.id} className="list__item" style={{ cursor: 'default' }}>
              <span className="badge">{index === 0 ? 'neuester' : `#${index + 1}`}</span>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{cp.label}</div>
                <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
                  {formatCheckpointTime(cp.at)} · {describeCheckpoint(cp)}
                </div>
              </div>
              {confirmId === cp.id ? (
                <div className="row">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      replaceDatabase(restoreCheckpoint(db, cp.id), { dirty: true });
                      onClose();
                    }}
                  >
                    Wirklich wiederherstellen
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                    Abbrechen
                  </Button>
                </div>
              ) : (
                <Button size="sm" onClick={() => setConfirmId(cp.id)}>
                  Wiederherstellen
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
