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


if __name__ == '__main__':
    unittest.main()
