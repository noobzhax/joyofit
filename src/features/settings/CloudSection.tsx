import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { formatCount, formatDateTime } from '@/format';
import { useCloud } from '@/state/CloudProvider';

/**
 * Sign in with the JoyoRogo account and upload the local data to the JoyoFit cloud. Uploads run on their
 * own after each sync; "Sync now" is for forcing one. Nothing is downloaded back into the app yet.
 */
export function CloudSection() {
  const cloud = useCloud();

  return (
    <Section title="Cloud" icon="cloud-upload">
      <AppText variant="caption" muted>
        Backs up steps, heart rate, sleep and workouts to your JoyoFit cloud with your JoyoRogo
        account. Off until you sign in. It only uploads; the app never reads from the cloud yet.
      </AppText>
      {!cloud.configured ? (
        <Notice tone="danger">
          This build has no cloud server URL. Deploy server/ and set EXPO_PUBLIC_JOYOFIT_CLOUD_URL,
          then rebuild.
        </Notice>
      ) : null}
      {cloud.error ? <Notice tone="danger">{cloud.error}</Notice> : null}
      <KeyValue icon="person-circle" label="Account" value={cloud.signedIn ? cloud.email : null} />
      {cloud.signedIn ? (
        <>
          <KeyValue icon="time" label="Last cloud sync" value={cloud.lastSyncAt ? formatDateTime(cloud.lastSyncAt) : null} />
          <KeyValue icon="cloud-upload" label="Waiting to upload" value={cloud.pending == null ? null : `${formatCount(cloud.pending)} rows`} />
          <Button
            label="Sync now"
            variant="primary"
            icon="sync"
            onPress={() => void cloud.syncNow()}
            disabled={!cloud.configured}
            loading={cloud.uploading}
          />
          <Button
            label="Sign out"
            variant="secondary"
            icon="log-out-outline"
            onPress={() => void cloud.signOut()}
            disabled={cloud.uploading}
          />
        </>
      ) : (
        <Button
          label="Sign in with JoyoRogo"
          variant="primary"
          icon="log-in-outline"
          onPress={() => void cloud.signIn()}
          disabled={cloud.sessionPending}
          loading={cloud.sessionPending}
        />
      )}
    </Section>
  );
}
