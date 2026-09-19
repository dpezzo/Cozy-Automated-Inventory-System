import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type RunRecord, type BatchRecord } from "../api";

export default function RunHistoryPage() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.listRuns().then(setRuns);
    api.listBatches().then(setBatches);
  }, []);

  const filtered = runs.filter(
    (r) => r.id.includes(search) || r.ruleId.includes(search) || r.status.includes(search.toLowerCase()),
  );

  return (
    <div>
      <h2>Run History</h2>
      <div className="filters">
        <input
          type="text"
          placeholder="Search by run ID, status, or rule"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 320 }}
        />
      </div>
      <div className="card">
        <h3>Runs</h3>
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Run ID</th>
              <th>Status</th>
              <th>Rule / hash</th>
              <th>Run date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td title={r.id}>{r.id.slice(0, 8)}</td>
                <td>{r.status}</td>
                <td title={r.ruleConfigHash}>
                  {r.ruleId} / {r.ruleConfigHash.slice(0, 10)}
                </td>
                <td>{r.runDate}</td>
                <td>
                  <Link to={`/runs/${r.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Batches</h3>
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Batch ID</th>
              <th>Run</th>
              <th>Import status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id}>
                <td>{new Date(b.createdAt).toLocaleString()}</td>
                <td title={b.id}>{b.id.slice(0, 8)}</td>
                <td>
                  <Link to={`/runs/${b.runId}`}>{b.runId.slice(0, 8)}</Link>
                </td>
                <td>{b.importStatus}</td>
                <td>
                  <Link to={`/batches/${b.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
