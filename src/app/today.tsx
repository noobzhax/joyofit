import { Redirect } from 'expo-router';

/** Today is the home tab now; `joyofit:///today` keeps working. */
export default function TodayRedirect() {
  return <Redirect href="/" />;
}
