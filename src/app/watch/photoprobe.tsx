// TEMPORARY on-device probe, removed after the photo face test. joyofit:///watch/photoprobe?op=info|add|delete|active&name=...
import { Asset } from 'expo-asset';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { HuaweiWear } from '@/wear';

export default function PhotoProbe() {
  const { op, name } = useLocalSearchParams<{ op?: string; name?: string }>();
  const [out, setOut] = useState('running');
  useEffect(() => {
    void (async () => {
      try {
        let result: unknown;
        if (op === 'add') {
          const asset = Asset.fromModule(require('../../../assets/icon.png'));
          await asset.downloadAsync();
          const ctx = ImageManipulator.manipulate(asset.localUri ?? asset.uri);
          const ref = await ctx.resize({ width: 408, height: 480 }).renderAsync();
          const png = await ref.saveAsync({ format: SaveFormat.PNG });
          result = await HuaweiWear.addPhoto(png.uri);
        } else if (op === 'delete') result = await HuaweiWear.deletePhoto(name ?? '');
        else if (op === 'active') result = await HuaweiWear.setPhotoFaceActive();
        else result = await HuaweiWear.getPhotoFace();
        setOut(JSON.stringify(result));
        console.log('PHOTOPROBE ok ' + JSON.stringify(result));
      } catch (e) {
        setOut(String(e));
        console.log('PHOTOPROBE error ' + String(e));
      }
    })();
  }, [op, name]);
  return (
    <View style={{ padding: 40 }}>
      <Text>{out}</Text>
    </View>
  );
}
