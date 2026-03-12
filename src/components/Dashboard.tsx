import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";

export function Dashboard() {
  const { signOut } = useAuthActions();
  const logs = useQuery(api.logs.list);
  const addLog = useMutation(api.logs.add);
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState<"info" | "warn" | "error" | "debug">(
    "info"
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    await addLog({ level, message: message.trim() });
    setMessage("");
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Log Viewer</h1>
        <button className="sign-out-btn" onClick={() => void signOut()}>
          Sign Out
        </button>
      </header>

      <form onSubmit={handleSubmit} className="log-form">
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as typeof level)}
        >
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
          <option value="debug">debug</option>
        </select>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Log message..."
        />
        <button type="submit">Add Log</button>
      </form>

      <div className="log-list">
        {logs === undefined ? (
          <p>Loading...</p>
        ) : logs.length === 0 ? (
          <p className="empty-state">No logs yet. Add your first log above.</p>
        ) : (
          logs.map((log) => (
            <div key={log._id} className={`log-entry log-${log.level}`}>
              <span className="log-level">[{log.level.toUpperCase()}]</span>
              <span className="log-message">{log.message}</span>
              <span className="log-time">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
