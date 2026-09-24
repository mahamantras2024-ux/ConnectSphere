import { Link } from 'react-router-dom';

export default function Register() {
  return (
    <div className="card">
      <h1>Account access</h1>
      <p>Staff accounts are provisioned internally by ConnectSphere. Contact your administrator to obtain your credentials.</p>
      <p>Online registration is not currently available.</p>
      <Link to="/login">Back to login</Link>
    </div>
  );
}
