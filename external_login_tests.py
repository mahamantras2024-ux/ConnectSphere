import unittest
from unittest.mock import Mock


class ExternalLoginService:
    """Minimal contract used by the external sign-in flow."""

    DASHBOARD_ROUTES = {
        'event_organiser': '/organizer/dashboard',
        'attendee': '/attendee/dashboard',
    }

    def __init__(self, api_client):
        self.api_client = api_client

    def login(self, email, password, audience='external'):
        response = self.api_client.post(
            '/auth/login',
            {'email': email, 'password': password, 'audience': audience},
        )
        user = response['user']
        dashboard = self.DASHBOARD_ROUTES.get(user['role'], '/dashboard')
        return user, dashboard


class ExternalLoginTests(unittest.TestCase):
    def setUp(self):
        self.api_client = Mock()
        self.service = ExternalLoginService(self.api_client)

    def test_event_organiser_login_posts_external_audience_and_navigates_to_organiser_dashboard(self):
        self.api_client.post.return_value = {
            'user': {'email': 'alice@example.com', 'role': 'event_organiser'},
            'token': 'organiser-token',
        }

        user, dashboard = self.service.login('alice@example.com', 'password123', 'external')

        self.api_client.post.assert_called_once_with(
            '/auth/login',
            {'email': 'alice@example.com', 'password': 'password123', 'audience': 'external'},
        )
        self.assertEqual(user['role'], 'event_organiser')
        self.assertEqual(dashboard, '/organizer/dashboard')

    def test_attendee_login_posts_external_audience_and_navigates_to_attendee_dashboard(self):
        self.api_client.post.return_value = {
            'user': {'email': 'sam@example.com', 'role': 'attendee'},
            'token': 'attendee-token',
        }

        user, dashboard = self.service.login('sam@example.com', 'password123', 'external')

        self.api_client.post.assert_called_once_with(
            '/auth/login',
            {'email': 'sam@example.com', 'password': 'password123', 'audience': 'external'},
        )
        self.assertEqual(user['role'], 'attendee')
        self.assertEqual(dashboard, '/attendee/dashboard')

    def test_unknown_role_login_navigates_to_default_dashboard(self):
        self.api_client.post.return_value = {
            'user': {'email': 'charlie@example.com', 'role': 'unknown'},
            'token': 'unknown-token',
        }

        user, dashboard = self.service.login('charlie@example.com', 'password123', 'external')

        self.api_client.post.assert_called_once_with(
            '/auth/login',
            {'email': 'charlie@example.com', 'password': 'password123', 'audience': 'external'},
        )
        self.assertEqual(user['role'], 'unknown')
        self.assertEqual(dashboard, '/dashboard') 

    def test_login_with_different_audience(self):
        self.api_client.post.return_value = {
            'user': {'email': 'david@example.com', 'role': 'event_organiser'},
            'token': 'organiser-token',
        }

        user, dashboard = self.service.login('david@example.com', 'password123', 'internal')

        self.api_client.post.assert_called_once_with(
            '/auth/login',
            {'email': 'david@example.com', 'password': 'password123', 'audience': 'internal'},
        )
        self.assertEqual(user['role'], 'event_organiser')
        self.assertEqual(dashboard, '/organizer/dashboard')  

    def test_login_with_missing_role_navigates_to_default_dashboard(self):
        self.api_client.post.return_value = {
            'user': {'email': 'eve@example.com'},
            'token': 'missing-role-token',
        }

        user, dashboard = self.service.login('eve@example.com', 'password123', 'external')

        self.api_client.post.assert_called_once_with(
            '/auth/login',
            {'email': 'eve@example.com', 'password': 'password123', 'audience': 'external'},
        )
        self.assertEqual(user['role'], None)
        self.assertEqual(dashboard, '/dashboard')

if __name__ == '__main__':
    unittest.main()
