package helpers

import io.gatling.core.Predef._
import io.gatling.http.Predef._

object BaseHelpers {
  val appUrl        = System.getProperty("baseUrl",  "http://localhost")
  val userCount     = Integer.getInteger("users",    5)
  val rampDuration  = Integer.getInteger("ramp",     30)
  val testDuration  = Integer.getInteger("duration", 180)  // ← ДОБАВЛЕНО: длительность теста после ramp-up

  val httpProtocol = http
    .baseUrl(appUrl)
    .acceptHeader("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
    .acceptEncodingHeader("gzip, deflate")
    .acceptLanguageHeader("en-US,en;q=0.5")
    .userAgentHeader("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    .warmUp(appUrl)                          // ← прогрев соединения перед тестом

  def thinkTime(min: Int = 2, max: Int = 5) = pause(min, max)
}
