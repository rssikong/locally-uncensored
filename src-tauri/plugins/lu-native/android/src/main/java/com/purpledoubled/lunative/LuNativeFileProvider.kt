package com.purpledoubled.lunative

import androidx.core.content.FileProvider

// A class of its own, so that this provider and one the app declares with
// androidx's FileProvider are two entries in the merged manifest and not
// one that the merger has to reconcile.
class LuNativeFileProvider : FileProvider()
