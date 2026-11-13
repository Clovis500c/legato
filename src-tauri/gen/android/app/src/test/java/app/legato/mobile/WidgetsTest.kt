package app.legato.mobile

import org.junit.Assert.assertArrayEquals
import org.junit.Test

class WidgetsTest {
  @Test
  fun aCoverIsCutToItsCenteredSquare() {
    assertArrayEquals(intArrayOf(0, 0, 300), Widgets.squareCrop(300, 300))
    assertArrayEquals(intArrayOf(50, 0, 200), Widgets.squareCrop(300, 200))
    assertArrayEquals(intArrayOf(0, 100, 200), Widgets.squareCrop(200, 400))
  }
}
