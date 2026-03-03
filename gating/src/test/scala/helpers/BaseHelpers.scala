package helpers

import io.gatling.core.Predef._
import io.gatling.http.Predef._

object BaseHelpers {

  // Читаем параметры с отладкой — увидим в логах что реально пришло
  val appUrl       = sys.props.getOrElse("baseUrl",  { println("⚠️  baseUrl not set, using default"); "http://localhost" })
  val userCount    = sys.props.getOrElse("users",    { println("⚠️  users not set, using default");   "5"   }).toInt
  val rampDuration = sys.props.getOrElse("ramp",     { println("⚠️  ramp not set, using default");    "30"  }).toInt
  val testDuration = sys.props.getOrElse("duration", { println("⚠️  duration not set, using default"); "300" }).toInt

  // Печатаем параметры в лог при старте — сразу видно что пришло из Jenkins
  println(s"""
    ╔══════════════════════════════════════╗
    ║       GATLING SIMULATION PARAMS      ║
    ╠══════════════════════════════════════╣
    ║  baseUrl  : $appUrl
    ║  users    : $userCount
    ║  ramp     : ${rampDuration}s
    ║  duration : ${testDuration}s
    ║  maxTotal : ${rampDuration + testDuration}s
    ╚══════════════════════════════════════╝
  """)

  val httpProtocol = http
    .baseUrl(appUrl)
    .acceptHeader("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
    .acceptEncodingHeader("gzip, deflate")
    .acceptLanguageHeader("en-US,en;q=0.5")
    .userAgentHeader("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
    // Не падаем если сервер вернул 500 — просто фиксируем как KO
    // Без этого Gatling может зависнуть ожидая повтора
    .disableFollowRedirect

  def thinkTime(min: Int = 2, max: Int = 5) = pause(min, max)
}
