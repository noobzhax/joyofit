import { Redirect } from 'expo-router';

/** Alarms live under the Watch tab; `joyofit:///alarms` keeps working. */
export default function AlarmsRedirect() {
  return <Redirect href="/watch/alarms" />;
}
