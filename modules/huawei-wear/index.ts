// Re-export the native module. On web, it will be resolved to HuaweiWearModule.web.ts
// and on native platforms to HuaweiWearModule.ts
export { default } from './src/HuaweiWearModule';
export * from './src/HuaweiWear.types';
export * from './src/HuaweiWearPhone.types';
export * from './src/HuaweiWearExtras.types';
export * from './src/HuaweiWearDiet.types';
export * from './src/HuaweiWearWatchface.types';
export * from './src/HuaweiWearFaceCustom.types';
export * from './src/HuaweiWearPhotoFace.types';
export * from './src/HuaweiWearP2p.types';
