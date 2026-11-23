def classFactory(iface):
    from .plugin import TerrainViewerPlugin
    return TerrainViewerPlugin(iface)
