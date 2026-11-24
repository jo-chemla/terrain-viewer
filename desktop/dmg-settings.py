# The macOS disk image's layout, for dmgbuild (https://dmgbuild.readthedocs.io),
# run by ci-bundle.sh:
#   dmgbuild -s dmg-settings.py -D app=<path>.app [-D background=none] "Terrain Viewer" out.dmg
# The app on the left, a link to /Applications on the right, an arrow
# between them: the drag-to-install window most Mac apps open with.
# dmgbuild writes Finder's .DS_Store itself, so no Finder or AppleScript is
# needed on the build machine (a CI runner has no reliable GUI session).
import os.path

application = defines["app"]  # noqa: F821 - dmgbuild provides `defines`
appname = os.path.basename(application)

format = "UDZO"
filesystem = "HFS+"
files = [application]
symlinks = {"Applications": "/Applications"}
icon_locations = {appname: (150, 190), "Applications": (450, 190)}

# The window: 600 x 400 points, icons only, no toolbar or sidebar.
window_rect = ((200, 120), (600, 400))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
icon_size = 128
text_size = 13
arrange_by = None
# dmgbuild's own arrow from the app to Applications; "none" for a plain
# window (ci-bundle.sh retries with it if the arrow cannot be drawn).
background = None if defines.get("background") == "none" else "builtin-arrow"  # noqa: F821
