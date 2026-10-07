"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  uploadCsvInChunks,
  type UploadProgress,
} from "@/lib/uploadClient";

type FileStatus = "pending" | "uploading" | "completed" | "failed";

type QueueItem = {
  id: string;
  file: File;
  status: FileStatus;
  error?: string;
  progress?: UploadProgress;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function FileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 2.5h9l5 5v14H5z" />
      <path d="M14 2.5V8h5" />
      <path d="M8 12h8M8 16h6" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 16v2.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V16" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 10 4 4 8-8" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  );
}

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);

    window.setTimeout(() => {
      setToast(null);
    }, 3500);
  }, []);

  const updateItem = useCallback(
    (id: string, updater: (item: QueueItem) => QueueItem) => {
      setItems((current) =>
        current.map((item) =>
          item.id === id ? updater(item) : item,
        ),
      );
    },
    [],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;

      const csvFiles = Array.from(files).filter((file) =>
        file.name.toLowerCase().endsWith(".csv"),
      );

      if (!csvFiles.length) {
        setError("Please select CSV files only.");
        return;
      }

      const nextItems: QueueItem[] = csvFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        status: "pending",
      }));

      setError(null);

      setItems((current) => [...current, ...nextItems]);

      showToast(
        `${nextItems.length} CSV ${
          nextItems.length === 1 ? "file" : "files"
        } added`,
      );
    },
    [showToast],
  );

  const removeItem = useCallback(
    (id: string) => {
      setItems((current) =>
        current.filter((item) => item.id !== id),
      );

      showToast("Removed from queue");
    },
    [showToast],
  );

  const startItem = useCallback(
    async (id: string) => {
      const item = items.find((entry) => entry.id === id);

      if (!item) return;

      setError(null);

      updateItem(id, (current) => ({
        ...current,
        status: "uploading",
        error: undefined,
      }));

      try {
        const result = await uploadCsvInChunks(item.file, {
          onProgress: (progress) => {
            updateItem(id, (current) => ({
              ...current,
              status:
                progress.state === "uploading"
                  ? "uploading"
                  : progress.state === "parsing"
                    ? "uploading"
                    : current.status,
              progress,
            }));
          },
        });

        updateItem(id, (current) => ({
          ...current,
          status: "completed",
          progress: result,
        }));

        showToast(`${item.file.name} uploaded successfully`);

        /*
         * No automatic analyze. The merchant explicitly chooses when to
         * analyze a dataset from the dashboard.
         */
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Upload failed";

        updateItem(id, (current) => ({
          ...current,
          status: "failed",
          error: message,
        }));

        showToast(`Upload failed · ${item.file.name}`);
      }
    },
    [items, updateItem, showToast],
  );

  const startAll = useCallback(async () => {
    const pending = items.filter(
      (item) => item.status === "pending",
    );

    for (const item of pending) {
      await startItem(item.id);
    }
  }, [items, startItem]);

  const completed = items.filter(
    (item) => item.status === "completed",
  ).length;

  const pending = items.filter(
    (item) => item.status === "pending",
  ).length;

  const uploading = items.filter(
    (item) => item.status === "uploading",
  ).length;

  const failed = items.filter(
    (item) => item.status === "failed",
  ).length;

  const totalRows = items.reduce(
    (total, item) => total + (item.progress?.rowsSent ?? 0),
    0,
  );

  const completionPercent =
    items.length === 0
      ? 0
      : Math.round((completed / items.length) * 100);

  return (
    <main className="upload-page">
      {/* =====================================================
          HEADER
      ===================================================== */}

      <header className="upload-header">
        <Link href="/" className="brand">

          <span className="brand-name">HelperX</span>

          <span className="brand-context">/ workspace</span>
        </Link>

        <div className="header-right">

          <button
            type="button"
            className="primary-button compact"
            onClick={() => router.push("/dashboard")}
          >
            Open dashboard
            <span>→</span>
          </button>
        </div>
      </header>

      {/* =====================================================
          MAIN CONTENT
      ===================================================== */}

      <div className="upload-container">
        {/* INTRO */}

        <div className="intro">
          <p className="eyebrow">BRING IN YOUR DATA</p>

          <h1>
            Upload the <em>CSVs you already have.</em>
          </h1>

          <p className="intro-copy">
            Orders, customers, products — drop the exports you
            already trust. HelperX will understand the
            structure and prepare your workspace automatically.
          </p>
        </div>

        {/* ===================================================
            UPLOAD AREA
        =================================================== */}

        <div className="upload-layout">
          {/* DROPZONE */}

          <section
            className={`dropzone ${dragging ? "is-dragging" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              handleFiles(event.dataTransfer.files);
            }}
          >
            <div className="dropzone-inner">
              <div className="upload-icon">
                <UploadIcon />
              </div>

              <h2>
                Drop your <em>CSV files</em>
              </h2>

              <p>or click anywhere here to browse</p>

              <button
                type="button"
                className="browse-button"
                onClick={(event) => {
                  event.stopPropagation();
                  inputRef.current?.click();
                }}
              >
                Browse files
              </button>

              <div className="dropzone-meta">
                <span>.CSV ONLY</span>
                <i />
                <span>MULTIPLE FILES</span>
                <i />
                <span>SECURE UPLOAD</span>
              </div>
            </div>
          </section>

          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            multiple
            hidden
            onChange={(event) => {
              handleFiles(event.target.files);
              event.target.value = "";
            }}
          />

          {/* =================================================
              SESSION CARD
          ================================================= */}

          <aside className="session-card">
            <div className="card-heading">
              <span>THIS SESSION</span>

              <span className="live">
                <i />
                LIVE
              </span>
            </div>

            <div className="session-numbers">
              <div>
                <strong>{items.length}</strong>
                <span>files</span>
              </div>

              <div>
                <strong>{completed}</strong>
                <span>complete</span>
              </div>
            </div>

            <div className="session-progress">
              <div
                style={{
                  width: `${completionPercent}%`,
                }}
              />
            </div>

            <div className="session-row">
              <span>Rows ingested</span>
              <strong>{totalRows.toLocaleString()}</strong>
            </div>

            <div className="session-row">
              <span>Uploading</span>
              <strong>{uploading}</strong>
            </div>

            <div className="session-row">
              <span>Pending</span>
              <strong>{pending}</strong>
            </div>

            <div className="session-row">
              <span>Failed</span>
              <strong className={failed ? "danger" : ""}>
                {failed}
              </strong>
            </div>
          </aside>
        </div>

        {/* ERROR */}

        {error && (
          <div className="error-banner">
            <strong>Upload issue</strong>
            <span>{error}</span>
          </div>
        )}

        {/* ===================================================
            QUEUE
        =================================================== */}

        {items.length > 0 && (
          <section className="queue-section">
            <div className="queue-heading">
              <div>
                <p className="eyebrow">UPLOAD QUEUE</p>

                <h2>
                  {items.length} file
                  {items.length === 1 ? "" : "s"}
                  <span> · {completed} complete</span>
                </h2>
              </div>

              {pending > 0 && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void startAll()}
                >
                  Upload all pending
                  <span>→</span>
                </button>
              )}
            </div>

            <div className="queue-list">
              {items.map((item) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  onStart={() => void startItem(item.id)}
                  onRemove={() => removeItem(item.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ===================================================
            NEXT SECTION
        =================================================== */}

        <section className="next-section">
          <div>
            <p className="eyebrow">WHAT HAPPENS NEXT</p>

            <h2>
              From raw CSV to <em>business context.</em>
            </h2>
          </div>

          <div className="steps">
            <div className="step">
              <span>01</span>

              <p>Your CSV is uploaded and verified.</p>
            </div>

            <div className="step">
              <span>02</span>

              <p>
                HelperX understands its schema and meaning.
              </p>
            </div>

            <div className="step">
              <span>03</span>

              <p>Your dashboard becomes ready for analysis.</p>
            </div>
          </div>
        </section>
      </div>

      {/* =====================================================
          TOAST
      ===================================================== */}

      {toast && (
        <div className="toast" role="status">
          <CheckIcon />
          {toast}
        </div>
      )}

      {/* =====================================================
          STYLES
      ===================================================== */}

      <style jsx>{`
        :global(html),
        :global(body) {
          margin: 0;
          padding: 0;
          background: #f5f3ed;
        }

        :global(*) {
          box-sizing: border-box;
        }

        .upload-page {
          --surface: #ffffff;
          --surface-soft: #faf8f2;
          --border: #e8e4d6;
          --border-strong: #dcd7c6;
          --ink: #33312a;
          --ink-soft: #6e6a5f;
          --ink-faint: #9c968a;
          --clay: #c05b39;
          --clay-deep: #a84a2b;
          --clay-tint: #f7e7de;
          --sage: #6f8b65;
          --sage-tint: #ebf1e7;
          --amber: #c2953c;
          --rose: #b36a54;

          min-height: 100vh;
          width: 100%;
          background: #f5f3ed;
          color: var(--ink);
          overflow-x: hidden;

          font-family:
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            Inter,
            Roboto,
            "Helvetica Neue",
            Arial,
            sans-serif;

          -webkit-font-smoothing: antialiased;
        }

        /* =================================================
           HEADER
        ================================================= */

        .upload-header {
          height: 70px;
          width: 100vw;
          margin-left: calc(50% - 50vw);

          padding: 0 44px;

          border-bottom: 1px solid var(--border);

          display: flex;
          align-items: center;
          justify-content: space-between;

          position: sticky;
          top: 0;
          z-index: 20;

          background: rgba(245, 243, 237, 0.88);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 10px;

          color: var(--ink);
          text-decoration: none;
        }

        .brand-mark {
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--clay);
        }

        .brand-name {
          font-family: Georgia, "Times New Roman", serif;
          font-size: 19px;
          line-height: 1;
          letter-spacing: -0.01em;
        }

        .brand-context,
        .step-label,
        .eyebrow,
        .card-heading,
        .live,
        .dropzone-meta {
          font-family: var(--font-mono, monospace);
          letter-spacing: 0.13em;
          font-size: 10px;
        }

        .brand-context {
          color: var(--ink-faint);
          margin-left: 2px;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 20px;
        }

        .step-label {
          color: var(--ink-faint);
        }

        /* =================================================
           BUTTONS  (highlighted accent)
        ================================================= */

        .primary-button,
        .browse-button {
          border: 0;
          border-radius: 999px;

          padding: 12px 21px;

          background: var(--clay);
          color: #fff9f5;

          font-size: 13.5px;
          font-weight: 600;

          cursor: pointer;

          display: inline-flex;
          align-items: center;
          gap: 9px;

          box-shadow: 0 4px 14px rgba(192, 91, 57, 0.25);

          transition:
            background 160ms ease,
            transform 160ms ease,
            box-shadow 160ms ease;
        }

        .primary-button span,
        .browse-button span {
          font-size: 15px;
          line-height: 1;
          opacity: 0.75;
          transition: transform 160ms ease;
        }

        .primary-button:hover,
        .browse-button:hover {
          background: var(--clay-deep);
          transform: translateY(-1px);
          box-shadow: 0 8px 22px rgba(192, 91, 57, 0.32);
        }

        .primary-button:hover span,
        .browse-button:hover span {
          transform: translateX(2px);
        }

        .primary-button:active,
        .browse-button:active {
          transform: translateY(0);
        }

        .primary-button.compact {
          padding: 9px 15px;
          font-size: 12.5px;
        }

        /* =================================================
           MAIN CONTAINER
        ================================================= */

        .upload-container {
          width: 100%;
          max-width: 1140px;
          margin: 0 auto;
          padding: 72px 28px 100px;
        }

        /* =================================================
           INTRO
        ================================================= */

        .intro {
          max-width: 720px;
          margin-bottom: 46px;
        }

        .eyebrow {
          color: var(--ink-faint);
          margin: 0 0 16px;

          display: inline-flex;
          align-items: center;
          gap: 10px;
        }

        .eyebrow::before {
          content: "";
          width: 24px;
          height: 1px;
          background: var(--clay);
        }

        .intro h1 {
          margin: 0;

          font-family: Georgia, "Times New Roman", serif;

          font-size: clamp(38px, 4.8vw, 58px);
          line-height: 1.06;
          letter-spacing: -0.025em;
          font-weight: 400;

          color: var(--ink);
        }

        .intro h1 em,
        .next-section h2 em,
        .dropzone h2 em {
          font-style: italic;
          color: var(--clay);
        }

        .intro-copy {
          max-width: 620px;
          margin: 22px 0 0;
          color: var(--ink-soft);
          font-size: 15.5px;
          line-height: 1.75;
        }

        /* =================================================
           UPLOAD LAYOUT
        ================================================= */

        .upload-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 320px;
          gap: 20px;
          align-items: stretch;
        }

        /* =================================================
           DROPZONE
        ================================================= */

        .dropzone {
          min-height: 380px;

          border: 1.5px dashed #d5cfc0;
          border-radius: 24px;

          background: #fefdfb;

          position: relative;
          overflow: hidden;

          cursor: pointer;

          display: grid;
          place-items: center;

          transition:
            border-color 200ms ease,
            background 200ms ease,
            box-shadow 200ms ease;
        }

        .dropzone:hover {
          border-color: #cf9d85;
          box-shadow: 0 10px 30px rgba(51, 49, 42, 0.05);
        }

        .dropzone.is-dragging {
          border-color: var(--clay);
          border-style: solid;
          background: var(--clay-tint);
          box-shadow: 0 12px 34px rgba(192, 91, 57, 0.1);
        }

        .dropzone-inner {
          position: relative;
          z-index: 2;
          text-align: center;
          padding: 48px 40px;
        }

        .upload-icon {
          width: 76px;
          height: 76px;

          border-radius: 50%;

          background: var(--clay-tint);
          color: var(--clay);

          display: grid;
          place-items: center;

          margin: 0 auto 28px;
        }

        .dropzone h2 {
          font-family: Georgia, "Times New Roman", serif;
          font-size: 29px;
          font-weight: 400;
          letter-spacing: -0.02em;
          margin: 0;
          color: var(--ink);
        }

        .dropzone p {
          color: var(--ink-faint);
          font-size: 13.5px;
          margin: 11px 0 24px;
        }

        .dropzone-meta {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 12px;
          color: var(--ink-faint);
          margin-top: 34px;
        }

        .dropzone-meta i {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: #c9c3b4;
        }

        /* =================================================
           SESSION CARD
        ================================================= */

        .session-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 24px;

          box-shadow: 0 2px 12px rgba(51, 49, 42, 0.04);

          padding: 24px;

          display: flex;
          flex-direction: column;
        }

        .card-heading {
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: var(--ink-faint);
        }

        .live {
          display: inline-flex;
          align-items: center;
          gap: 7px;

          color: var(--sage);
          background: var(--sage-tint);

          padding: 4px 11px;
          border-radius: 999px;
        }

        .live i {
          width: 6px;
          height: 6px;
          background: var(--sage);
          border-radius: 50%;
          animation: pulse 2.4s ease-in-out infinite;
        }

        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.35;
          }
        }

        .session-numbers {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          margin: 28px 0 22px;
        }

        .session-numbers div {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .session-numbers strong {
          font-family: Georgia, "Times New Roman", serif;
          font-size: 36px;
          font-weight: 400;
          line-height: 1;
          color: var(--ink);
        }

        .session-numbers span {
          color: var(--ink-faint);
          font-size: 11px;
        }

        .session-progress {
          height: 6px;
          background: #ede9dc;
          border-radius: 999px;
          overflow: hidden;
          margin-bottom: 26px;
        }

        .session-progress div {
          height: 100%;
          background: var(--clay);
          border-radius: 999px;
          transition: width 300ms ease;
        }

        .session-row {
          display: flex;
          justify-content: space-between;

          padding: 11px 0;

          border-top: 1px solid var(--border);

          font-size: 12.5px;
          color: var(--ink-soft);
        }

        .session-row strong {
          font-family: var(--font-mono, monospace);
          font-size: 11.5px;
          font-weight: 500;
          color: var(--ink);
        }

        .danger {
          color: var(--rose) !important;
        }

        /* =================================================
           ERROR
        ================================================= */

        .error-banner {
          border: 1px solid #efd5ca;
          background: #fbefea;
          color: #a5543c;
          border-radius: 16px;
          padding: 14px 18px;
          margin-top: 20px;
          display: flex;
          gap: 10px;
          align-items: baseline;
          font-size: 13px;
        }

        /* =================================================
           QUEUE
        ================================================= */

        .queue-section {
          margin-top: 64px;
        }

        .queue-heading {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 20px;
          margin-bottom: 18px;
        }

        .queue-heading h2 {
          font-family: Georgia, "Times New Roman", serif;
          font-size: 25px;
          font-weight: 400;
          letter-spacing: -0.015em;
          margin: 0;
          color: var(--ink);
        }

        .queue-heading h2 span {
          color: var(--ink-faint);
          font-size: 16px;
          font-style: italic;
        }

        .queue-list {
          display: grid;
          gap: 12px;
        }

        /* =================================================
           NEXT SECTION
        ================================================= */

        .next-section {
          margin-top: 96px;
          padding-top: 56px;
          border-top: 1px solid var(--border);

          display: grid;
          grid-template-columns: 1fr 1.55fr;
          gap: 64px;
        }

        .next-section h2 {
          font-family: Georgia, "Times New Roman", serif;
          font-size: 33px;
          line-height: 1.1;
          font-weight: 400;
          letter-spacing: -0.02em;
          margin: 0;
          color: var(--ink);
        }

        .steps {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }

        .step {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 18px;
          padding: 22px 20px 24px;

          transition:
            border-color 180ms ease,
            box-shadow 180ms ease;
        }

        .step:hover {
          border-color: var(--border-strong);
          box-shadow: 0 4px 16px rgba(51, 49, 42, 0.05);
        }

        .step span {
          display: inline-flex;
          align-items: center;
          justify-content: center;

          width: 30px;
          height: 30px;
          border-radius: 50%;

          background: var(--clay-tint);
          color: var(--clay-deep);

          font-family: var(--font-mono, monospace);
          font-size: 11px;
        }

        .step p {
          font-size: 13.5px;
          color: var(--ink-soft);
          line-height: 1.6;
          margin: 18px 0 0;
        }

        /* =================================================
           TOAST
        ================================================= */

        .toast {
          position: fixed;
          bottom: 28px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 50;

          background: #3b3831;
          color: #f3f1e9;

          border-radius: 999px;
          padding: 12px 19px;

          font-size: 12.5px;

          display: flex;
          align-items: center;
          gap: 9px;

          box-shadow: 0 12px 34px rgba(0, 0, 0, 0.18);

          animation: toast-in 260ms ease;
        }

        .toast svg {
          color: #a3c293;
          flex-shrink: 0;
        }

        @keyframes toast-in {
          from {
            opacity: 0;
            transform: translate(-50%, 8px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }

        /* =================================================
           RESPONSIVE
        ================================================= */

        @media (max-width: 900px) {
          .upload-header {
            padding: 0 20px;
          }

          .brand-context,
          .step-label {
            display: none;
          }

          .upload-container {
            padding: 52px 20px 80px;
          }

          .upload-layout {
            grid-template-columns: 1fr;
          }

          .next-section {
            grid-template-columns: 1fr;
            gap: 36px;
          }
        }

        @media (max-width: 620px) {
          .upload-header {
            height: 64px;
          }

          .dropzone {
            min-height: 340px;
          }

          .dropzone-inner {
            padding: 32px 22px;
          }

          .dropzone-meta {
            flex-wrap: wrap;
          }

          .queue-heading {
            align-items: flex-start;
            flex-direction: column;
          }

          .steps {
            grid-template-columns: 1fr;
          }

          .next-section {
            margin-top: 72px;
            padding-top: 40px;
          }
        }
      `}</style>
    </main>
  );
}

/* =========================================================
   QUEUE ROW
========================================================= */

function QueueRow({
  item,
  onStart,
  onRemove,
}: {
  item: QueueItem;
  onStart: () => void;
  onRemove: () => void;
}) {
  const { file, status, progress, error } = item;

  const percentage =
    progress && progress.totalChunks > 0
      ? Math.min(
          100,
          Math.round((progress.chunksSent / progress.totalChunks) * 100),
        )
      : 0;

  const statusText: Record<FileStatus, string> = {
    pending: "Ready to upload",
    uploading: "Uploading",
    completed: "Uploaded successfully",
    failed: "Upload failed",
  };

  return (
    <div className="queue-row-wrapper">
      <div className="queue-row">
        <div className="queue-file-icon">
          <FileIcon />
        </div>

        <div className="queue-file-info">
          <div className="queue-file-top">
            <strong>{file.name}</strong>

            <span>{formatBytes(file.size)}</span>
          </div>

          <div className="queue-file-status">
            <span className={`status-dot status-${status}`} />

            <span>{statusText[status]}</span>

            {status === "uploading" && progress && (
              <>
                <i />

                <span>
                  chunk {progress.chunksSent ?? 0}/
                  {progress.totalChunks ?? 0}
                </span>

                <i />

                <span>
                  {progress.rowsSent ?? 0}/
                  {progress.totalRows ?? 0} rows
                </span>

                <i />

                <span>{percentage}%</span>
              </>
            )}

            {status === "completed" &&
              progress?.rowsSent !== undefined && (
                <>
                  <i />

                  <span>
                    {progress.rowsSent.toLocaleString()} rows
                  </span>
                </>
              )}
          </div>

          {(status === "uploading") && (
            <div className="queue-progress">
              <div
                style={{
                  width: `${percentage}%`,
                }}
              />
            </div>
          )}

          {status === "completed" && (
            <div className="queue-progress complete">
              <div
                style={{
                  width: "100%",
                }}
              />
            </div>
          )}

          {error && <p className="queue-error">{error}</p>}
        </div>

        <div className="queue-actions">
          {status === "pending" && (
            <>
              <button
                type="button"
                className="row-upload-button"
                onClick={onStart}
              >
                Upload
              </button>

              <button
                type="button"
                className="icon-button"
                onClick={onRemove}
                aria-label={`Remove ${file.name}`}
              >
                <CloseIcon />
              </button>
            </>
          )}

          {(status === "uploading") && (
            <span className="spinner" />
          )}

          {(status === "completed" || status === "failed") && (
            <button
              type="button"
              className="icon-button"
              onClick={onRemove}
              aria-label={`Dismiss ${file.name}`}
            >
              {status === "completed" ? (
                <CheckIcon />
              ) : (
                <CloseIcon />
              )}
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .queue-row-wrapper {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 18px;

          box-shadow: 0 1px 8px rgba(51, 49, 42, 0.04);

          transition:
            border-color 180ms ease,
            box-shadow 180ms ease;
        }

        .queue-row-wrapper:hover {
          border-color: var(--border-strong);
          box-shadow: 0 4px 16px rgba(51, 49, 42, 0.06);
        }

        .queue-row {
          display: grid;

          grid-template-columns:
            44px
            minmax(0, 1fr)
            auto;

          gap: 16px;

          align-items: center;

          padding: 18px 20px;
        }

        .queue-file-icon {
          width: 44px;
          height: 44px;

          border-radius: 14px;

          background: var(--clay-tint);
          color: var(--clay);

          display: grid;
          place-items: center;
        }

        .queue-file-info {
          min-width: 0;
        }

        .queue-file-top {
          display: flex;
          align-items: baseline;
          gap: 12px;
        }

        .queue-file-top strong {
          font-size: 14.5px;
          font-weight: 600;
          letter-spacing: -0.005em;
          color: var(--ink);

          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .queue-file-top span,
        .queue-file-status {
          font-family: var(--font-mono, monospace);
          font-size: 10px;
          letter-spacing: 0.05em;
          color: var(--ink-faint);
        }

        .queue-file-status {
          display: flex;
          align-items: center;
          gap: 9px;
          margin-top: 7px;
        }

        .queue-file-status i {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: #d5d0c2;
        }

        .status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #b9b2a3;
          flex-shrink: 0;
        }

        .status-uploading {
          background: var(--amber);
        }

        .status-completed {
          background: var(--sage);
        }

        .status-failed {
          background: var(--rose);
        }

        .queue-progress {
          height: 5px;
          background: #efece0;
          border-radius: 999px;
          margin-top: 12px;
          max-width: 520px;
          overflow: hidden;
        }

        .queue-progress div {
          height: 100%;
          background: var(--clay);
          border-radius: 999px;
          transition: width 220ms ease;
        }

        .queue-progress.complete div {
          background: var(--sage);
          opacity: 0.75;
        }

        .queue-error {
          color: var(--rose);
          font-size: 11.5px;
          margin: 8px 0 0;
        }

        .queue-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .row-upload-button {
          border: 0;
          border-radius: 999px;

          background: var(--clay-tint);
          color: var(--clay-deep);

          padding: 8px 16px;

          font-size: 12px;
          font-weight: 600;

          cursor: pointer;

          transition:
            background 150ms ease,
            color 150ms ease;
        }

        .row-upload-button:hover {
          background: var(--clay);
          color: #fff9f5;
        }

        .icon-button {
          width: 34px;
          height: 34px;

          border-radius: 50%;
          border: 1px solid var(--border);

          background: var(--surface);
          color: var(--ink-soft);

          display: grid;
          place-items: center;

          cursor: pointer;

          transition:
            background 150ms ease,
            border-color 150ms ease;
        }

        .icon-button:hover {
          background: var(--surface-soft);
          border-color: var(--border-strong);
        }

        .spinner {
          width: 17px;
          height: 17px;

          border: 1.6px solid #e2decf;
          border-top-color: var(--clay);

          border-radius: 50%;

          animation: spin 700ms linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 620px) {
          .queue-row {
            grid-template-columns:
              44px
              minmax(0, 1fr);

            padding: 16px;
          }

          .queue-actions {
            grid-column: 2;
            justify-content: flex-start;
            margin-top: 2px;
          }

          .queue-file-top {
            flex-direction: column;
            align-items: flex-start;
            gap: 3px;
          }
        }
      `}</style>
    </div>
  );
}