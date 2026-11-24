# -*- coding: utf-8 -*-
# ******************************************************************************
#
# Send2MapApp
# ---------------------------------------------------------
# Opens the place clicked in QGIS in Google Earth and other viewers.
#
# Copyright (C) 2013 Maxim Dubinin (sim@gis-lab.info), NextGIS (info@nextgis.org)
# Copyright (C) 2025-2026 Jonathan Chemla, Iconem
#
# This source is free software; you can redistribute it and/or modify it under
# the terms of the GNU General Public License as published by the Free
# Software Foundation, either version 2 of the License, or (at your option)
# any later version. See LICENSE.
#
# ******************************************************************************


def classFactory(iface):
    from .send2map_app import Send2MapApp

    return Send2MapApp(iface)
