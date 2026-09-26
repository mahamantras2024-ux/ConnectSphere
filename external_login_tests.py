import unittest
import requests


class ApiClient:
    def __init__(self, base_url):
        self.base_url = base_url.rstrip('/')

    def post(self, path, data):
        response = requests.post(
            f"{self.base_url}{path}",
            json=data,
            timeout=10
        )

        return response.json()


class ExternalLoginService:
    """External login flow using the real backend API."""

    DASHBOARD_ROUTES = {
        'event_organiser': '/organizer/dashboard',
        'attendee': '/attendee/dashboard',
    }

    def __init__(self, api_client):
        self.api_client = api_client

    def login(self, email, password, audience='external'):
        username = (email or '').strip()

        if not username or username.count('@') != 1:
            raise ValueError('Invalid username.')

        local_part, domain = username.split('@', 1)

        if not local_part or not domain or '.' not in domain:
            raise ValueError('Invalid username.')

        if not password or not str(password).strip():
            raise ValueError('Invalid password.')

        response = self.api_client.post(
            '/auth/login',
            {
                'email': username,
                'password': password,
                'audience': audience,
            },
        )

        if response.get('error'):
            raise ValueError(response['error'])

        user = response.get('user')

        if user is None:
            raise ValueError('Invalid username or password.')

        dashboard = self.DASHBOARD_ROUTES.get(
            user.get('role'),
            '/dashboard'
        )

        return user, dashboard


class ExternalLoginTests(unittest.TestCase):

    def setUp(self):
        self.api_client = ApiClient(
            'http://localhost:4000/api'
        )

        self.service = ExternalLoginService(
            self.api_client
        )

        # Hardcoded test accounts from Supabase
        self.organiser_email = 'organiser1@example.com'
        self.organiser_password = 'Organiser1'

        self.attendee_email = 'attendee@example.com'
        self.attendee_password = 'Password123'

    def test_event_organiser_login(self):
        user, dashboard = self.service.login(
            self.organiser_email,
            self.organiser_password,
            'external'
        )

        self.assertEqual(
            user['role'],
            'event_organiser'
        )

        self.assertEqual(
            dashboard,
            '/organizer/dashboard'
        )

    def test_attendee_login(self):
        user, dashboard = self.service.login(
            self.attendee_email,
            self.attendee_password,
            'external'
        )

        self.assertEqual(
            user['role'],
            'attendee'
        )

        self.assertEqual(
            dashboard,
            '/attendee/dashboard'
        )

    def test_login_rejects_invalid_username(self):
        invalid_usernames = [
            '',
            'not-an-email',
            'user@',
            'user.example.com'
        ]

        for invalid_username in invalid_usernames:
            with self.subTest(
                invalid_username=invalid_username
            ):
                with self.assertRaisesRegex(
                    ValueError,
                    'Invalid username'
                ):
                    self.service.login(
                        invalid_username,
                        'ValidPassword123',
                        'external'
                    )

    def test_login_rejects_blank_password(self):
        invalid_passwords = [
            '',
            '   ',
            None
        ]

        for invalid_password in invalid_passwords:
            with self.subTest(
                invalid_password=invalid_password
            ):
                with self.assertRaisesRegex(
                    ValueError,
                    'Invalid password'
                ):
                    self.service.login(
                        self.organiser_email,
                        invalid_password,
                        'external'
                    )

    def test_login_rejects_invalid_credentials_response(self):
        with self.assertRaisesRegex(
            ValueError,
            'Invalid username or password'
        ):
            self.service.login(
                self.organiser_email,
                'WrongPassword123',
                'external'
            )

if __name__ == '__main__':
    unittest.main()