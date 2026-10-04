// File: Displays the fallback for frontend URLs without a registered route.
import { Link } from 'react-router-dom';

// Renders the missing-page message and dashboard return link.
export default function NotFound() {
  return (
    <div className="card">
      <h1>Page not found</h1>
      <p><Link to="/dashboard">Back to dashboard</Link></p>
    </div>
  );
}
