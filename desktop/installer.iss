; Windows installer for the unpacked portable app (ci-bundle.sh). Electrobun's
; own Setup.exe has no silent mode, always launches the app, and treats --quiet
; alone as "uninstall" (package/src/extractor/main.zig), so winget cannot drive
; it. This one installs per user, with no admin prompt, and adds a Start Menu
; entry and an Add/Remove Programs entry. Winget passes /VERYSILENT by itself.
#define AppVersion GetEnv("TV_VERSION")
#define AppSource GetEnv("TV_APP_DIR")
#define OutputName GetEnv("TV_OUTPUT_NAME")

[Setup]
AppId=Iconem.TerrainViewer
AppName=Terrain Viewer
AppVersion={#AppVersion}
AppVerName=Terrain Viewer {#AppVersion}
VersionInfoVersion={#AppVersion}
AppPublisher=Iconem
AppPublisherURL=https://iconem.com/
AppSupportURL=https://github.com/Iconem/terrain-viewer/issues
AppUpdatesURL=https://github.com/Iconem/terrain-viewer/releases
DefaultDirName={userpf}\Terrain Viewer
DisableDirPage=auto
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
LicenseFile=..\LICENSE
SetupIconFile=icons\icon.ico
UninstallDisplayIcon={app}\icon.ico
OutputDir=artifacts
OutputBaseFilename={#OutputName}
Compression=lzma2
SolidCompression=yes
CloseApplications=yes

[Files]
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "icons\icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Terrain Viewer"; Filename: "{app}\bin\launcher.exe"; WorkingDir: "{app}\bin"; IconFilename: "{app}\icon.ico"

[UninstallDelete]
; The app writes its log and temp files next to the launcher.
Type: filesandordirs; Name: "{app}"

[Run]
Filename: "{app}\bin\launcher.exe"; Description: "Start Terrain Viewer"; Flags: nowait postinstall skipifsilent
