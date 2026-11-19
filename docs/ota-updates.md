# 自动更新（EAS Update）

App 启动时会在后台检查更新，下载好的新版本在**下次打开 App** 时生效；网络不通时继续用旧版本。

## 发布一次更新

```bash
cd mobile
npx eas-cli update --channel preview --message "这次改了什么"
```

- `preview` 渠道对应 `eas build --profile preview` 打出来的 APK。
- 只改 JS/TS、图片等资源时用这个；用户不用重新安装。

## 什么时候必须重新打包

`runtimeVersion` 用的是 `fingerprint` 策略：新增/升级原生库、改 app.json 里的图标、权限、插件等，
指纹会变，旧安装包**收不到**这类更新（不会被错推），需要重新 `eas build` 并重新安装。
可以用 `npx expo-updates fingerprint:generate --platform android` 对比判断。

Expo Go 里不走这套更新，调试照旧。
