import { Redirect } from 'expo-router';

/** The log lives under Settings > Advanced; `joyofit:///log` keeps working. */
export default function LogRedirect() {
  return <Redirect href="/settings/log" />;
}
