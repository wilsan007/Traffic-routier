import { useEffect } from 'react';
import { Tabs, router } from 'expo-router';
import { Text } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../../lib/auth-context';
import { registerPushToken } from '../../lib/push';
import { getAlertsSocket } from '../../lib/socket';

export default function TabsLayout() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user]);

  // Enregistre le jeton de notification push dès qu'un agent est connecté
  useEffect(() => {
    if (user) registerPushToken();
  }, [user]);

  // Écoute globale des alertes — déclenche une notification locale sur chaque alerte
  useEffect(() => {
    if (!user) return;
    let cleanup: (() => void) | undefined;
    getAlertsSocket().then((socket) => {
      const handler = (alert: { capture: { plateNumberNormalized: string }; hotlistEntry: { reason: string; priority: string } }) => {
        Notifications.scheduleNotificationAsync({
          content: {
            title: `🚨 Alerte ${alert.hotlistEntry.priority}`,
            body: `${alert.capture.plateNumberNormalized} — ${alert.hotlistEntry.reason}`,
            sound: 'default',
          },
          trigger: null,
        });
      };
      socket.on('alert.new', handler);
      cleanup = () => socket.off('alert.new', handler);
    });
    return () => cleanup?.();
  }, [user]);

  if (loading || !user) return null;

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#2f5fdb' }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Accueil', tabBarIcon: () => <Text>🏠</Text> }}
      />
      <Tabs.Screen
        name="capture"
        options={{ title: 'Scanner', tabBarIcon: () => <Text>📷</Text> }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: 'Recherche', tabBarIcon: () => <Text>🔍</Text> }}
      />
      <Tabs.Screen
        name="alerts"
        options={{ title: 'Alertes', tabBarIcon: () => <Text>🚨</Text> }}
      />
      <Tabs.Screen
        name="cameras"
        options={{ title: 'Caméras', tabBarIcon: () => <Text>📹</Text> }}
      />
      <Tabs.Screen
        name="messages"
        options={{ title: 'Messages', tabBarIcon: () => <Text>💬</Text> }}
      />
    </Tabs>
  );
}
