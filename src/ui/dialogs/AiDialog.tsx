/**
 * KI-Export/-Import mit Diff-Vorschau.
 * Export erzeugt eine Markdown-Datei für das LLM, Import nimmt dessen Antwort
 * entgegen und zeigt vor der Übernahme genau, was sich ändert.
 */
import { useMemo, useState } from "react";
import {
  buildExportMarkdown,
  computeDiff,
  parseImport,
  type DiffEntry,
} from "../../ai/exchange";
import { downloadText } from "../../persistence/fileStore";
import { useStore } from "../../state/store";
import { Button, Modal, Segmented } from "../components/controls";

export function AiDialog({ onClose }: { onClose: () => void }) {
  const { db, replaceDatabase } = useStore();
  const [tab, setTab] = useState<"export" | "import">("export");
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  const markdown = useMemo(() => buildExportMarkdown(db), [db]);

  const parsed = useMemo(
    () => (tab === "import" && text.trim() ? parseImport(text) : null),
    [tab, text],
  );
  const diff = useMemo<DiffEntry[] | null>(
    () => (parsed?.ok && parsed.db ? computeDiff(db, parsed.db) : null),
    [parsed, db],
  );

  return (
    <Modal
      wide
      title="KI-Austausch"
      onClose={onClose}
      footer={
        tab === "export" ? (
          <>
            <Button
              onClick={() => {
                void navigator.clipboard
                  .writeText(markdown)
                  .then(() => setCopied(true));
              }}
            >
              {copied ? "Kopiert" : "In Zwischenablage"}
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                downloadText(markdown, "mpt-export.md", "text/markdown")
              }
            >
              Als Markdown herunterladen
            </Button>
          </>
        ) : (
          <>
            <span className="faint grow" style={{ fontSize: "var(--fs-sm)" }}>
              {diff
                ? `${diff.length} Änderung${diff.length === 1 ? "" : "en"}`
                : "Antwort des LLM einfügen"}
            </span>
            <Button
              variant="primary"
              disabled={!parsed?.ok || !parsed.db}
              onClick={() => {
                if (!parsed?.db) return;
                // Checkpoints des aktuellen Bestands bleiben erhalten.
                replaceDatabase(
                  { ...parsed.db, checkpoints: db.checkpoints },
                  { dirty: true },
                );
                onClose();
              }}
            >
              Übernehmen
            </Button>
          </>
        )
      }
    >
      <Segmented
        value={tab}
        onChange={(t) => setTab(t as "export" | "import")}
        options={[
          { value: "export", label: "Export" },
          { value: "import", label: "Import" },
        ]}
      />

      {tab === "export" ? (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Die Datei enthält den vollständigen Datenbestand plus Anweisungen
            zum Schema. An ein LLM geben, ändern lassen, und die Antwort im
            Reiter "Import" einfügen.
          </p>
          <textarea
            className="textarea mono"
            readOnly
            rows={16}
            value={markdown}
            onFocus={(e) => e.currentTarget.select()}
          />
        </>
      ) : (
        <>
          <textarea
            className="textarea mono"
            rows={10}
            placeholder="Antwort des LLM hier einfügen (der ```json-Block reicht)..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          {parsed && !parsed.ok && (
            <p style={{ color: "var(--critical)", margin: 0 }}>
              {parsed.error}
            </p>
          )}

          {parsed?.notes && parsed.notes.length > 0 && (
            <ul
              className="muted"
              style={{
                margin: 0,
                paddingLeft: "var(--sp-4)",
                fontSize: "var(--fs-sm)",
              }}
            >
              {parsed.notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          )}

          {diff && (
            <div className="col">
              <div className="field__label">Vorschau der Änderungen</div>
              {diff.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  Keine Unterschiede zum aktuellen Stand.
                </p>
              ) : (
                <div className="diff">
                  {diff.map((entry, i) => (
                    <div
                      key={i}
                      className={`diff__row diff__row--${entry.kind}`}
                    >
                      <span className="diff__kind">
                        {entry.kind === "add"
                          ? "+"
                          : entry.kind === "del"
                            ? "-"
                            : "~"}
                      </span>
                      <span className="nowrap">{entry.scope}</span>
                      <span className="grow truncate">{entry.label}</span>
                      {entry.detail && (
                        <span className="truncate" style={{ opacity: 0.75 }}>
                          {entry.detail}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
