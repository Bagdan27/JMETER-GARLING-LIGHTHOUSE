package helpers

import io.gatling.core.Predef._
import io.gatling.http.Predef._

object BaseHelpers {
  val appUrl        = System.getProperty("baseUrl", "http://localhost")
  val userCount     = Integer.getInteger("users", 5).toInt
  val rampDuration  = Integer.getInteger("ramp", 60).toInt
  val testDuration  = Integer.getInteger("duration", 300).toInt 

  val commonHeaders = Map(
    "Accept" -> "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "User-Agent" -> "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  )

  val httpProtocol = http
    .baseUrl(appUrl)
    .acceptHeader("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
    .acceptEncodingHeader("gzip, deflate")
    .acceptLanguageHeader("en-US,en;q=0.5")
    .userAgentHeader("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

  def thinkTime(min: Int = 2, max: Int = 5) = pause(min, max)
}
