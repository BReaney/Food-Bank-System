import { useEffect, useState } from "react";

function App() {
  const [apiStatus, setApiStatus] = useState("Checking API...");

  useEffect(() => {
    fetch("http://localhost:3001/api/health")
      .then(response => {
        if (!response.ok) {
          throw new Error("API request failed");
        }

        return response.json();
      })
      .then(data => {
        setApiStatus(data.message);
      })
      .catch(() => {
        setApiStatus("Could not connect to backend");
      });
  }, []);

  return (
    <main>
      <h1>UVSS Food Bank Booking System</h1>
      <p>React frontend is running.</p>
      <p>Backend status: {apiStatus}</p>
    </main>
  );
}

export default App;