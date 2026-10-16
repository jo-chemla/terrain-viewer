# F3 · Elevation picker: points, profile, routes and the slicer

Intro: A reviewer opens the Elevation Picker over Zermatt, picks two points and reads their profile in the side panel, docks the profile under the map, routes the path with BRouter or Valhalla and changes the routing profile, checks the line of sight with a mast, then clears the points and plays with the plane slicer.

Notes: Picks, docking and routing are app actions, not URL state. Those screens are captured by agent-browser replaying the clicks listed in screens.json, so they are Observed like the others.

```mermaid
flowchart TD
  ep_open[Elevation picker open] ==>|Pick on, click two points| ep_points[Two points, profile in the side panel]
  ep_points ==>|Dock under the map| ep_dock[Profile docked under the map]
  ep_dock ==> path{Path?}
  path ==>|BRouter| ep_brouter[Path: BRouter, hiking]
  path -->|Valhalla| ep_valhalla[Path: Valhalla]
  ep_brouter -->|Routing profile: bike| ep_brouter_bike[Routing profile: bike]
  ep_brouter ==>|Mast height 30 m| ep_mast[Line of sight with a 30 m mast]
  ep_mast ==>|Clear points, slicer on| ep_slicer[Plane slicer: flood below 2100 m]
  ep_slicer ==> which{Which way?}
  which ==>|Raise the water| ep_slicer_raise[Water rises to 2600 m]
  which -->|Flip to Above| ep_slicer_above[Peaks above 3500 m]
  which -->|Reference: LRM| ep_slicer_lrm[Hollows below the local relief]
  ep_slicer_raise ==>|Colour and opacity| ep_slicer_color[Slicer colour and opacity]
  ep_slicer_color ==>|Switch to 3D| ep_slicer_3d[Flooded valley in 3D]
  ep_slicer_3d -.->|Back to 2D| ep_slicer_raise
  ep_slicer_above -.->|Try the other side| which
```
