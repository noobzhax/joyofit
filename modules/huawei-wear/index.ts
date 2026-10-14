// Re-export the native module. On web, it will be resolved to HuaweiWearModule.web.ts
// and on native platforms to HuaweiWearModule.ts
export { default } from './src/HuaweiWearModule';
export * from './src/HuaweiWear.types';
