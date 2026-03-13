import { useState } from "react";
import { login, getMe, getProjects } from "./api";

function App() {
  const [email, setEmail] = useState("test1@trackqa.com");
  const [password, setPassword] = useState("Password123!");
  const [status, setStatus] = useState("");
  const [me, setMe] = useState(null);
  const [projects, setProjects] = useState([]);

  async function handleLogin() {
    try {
      setStatus("Logging in...");
      await login(email, password);

      setStatus("Fetching profile...");
      const profile = await getMe();
      setMe(profile);

      setStatus("Fetching projects...");
      const myProjects = await getProjects();
      setProjects(myProjects);

      setStatus("Done ✅");
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>TrackQA</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
          type="password"
        />
        <button onClick={handleLogin}>Login</button>
      </div>

      <div style={{ marginBottom: 12 }}>{status}</div>

      {me && (
        <div style={{ marginBottom: 12 }}>
          <strong>Logged in as:</strong> {me.email}
        </div>
      )}

      <h2>Projects</h2>
      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            <strong>{p.name}</strong> — {p.description || "No description"}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;