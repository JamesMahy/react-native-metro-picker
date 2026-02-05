# React Native Metro Picker — Chrome Extension

A Chrome extension that connects to multiple React Native Metro debug targets and opens the React Native DevTools frontend.

When debugging React Native, pressing `j` only opens the browser on the host machine. 

This tool was built to allow me to get the developer console up for multiple React Native hosts (VMs / Mac minis), from a single machine.

## Setup

1. Clone this repo
2. Pull the DevTools frontend:
   ```sh
   npm run update-devtools
   ```
3. Launch host metro with `npm run start -- --host 0.0.0.0` OR expo `expo run:ios -- --host lan`
4. Open `chrome://extensions/`, enable **Developer mode**, and click **Load unpacked**
5. Select this project directory

## Usage

1. Click the extension icon to open the DevTools panel
2. Add a host (e.g. `192.168.1.10:8081`) — port defaults to 8081 if omitted
3. The extension fetches `/json` from the host to discover debug targets
4. Click **Open DevTools** on a target to launch the React Native debugger frontend

## Updating the DevTools frontend

The bundled frontend comes from `@react-native/debugger-frontend`. To update:

```sh
# Pull the latest version
npm run update-devtools

# Or pin a specific version
npm run update-devtools -- --version 0.79.0
```

This downloads the package, extracts it into `devtools/`, and prints the installed version. The `devtools/` directory is gitignored since it is pulled via the script.
