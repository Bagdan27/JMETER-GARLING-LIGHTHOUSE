package simulations

import io.gatling.core.Predef._
import helpers.BaseHelpers._
import scenarios.UserScenarios
import scala.concurrent.duration._

class EcommerceSimulation extends Simulation {

  println(s"▶ Starting simulation: users=$userCount ramp=${rampDuration}s duration=${testDuration}s maxDuration=${rampDuration + testDuration}s")

  setUp(
    UserScenarios.scn.inject(
      rampConcurrentUsers(0).to(userCount).during(rampDuration.seconds),
      constantConcurrentUsers(userCount).during(testDuration.seconds)
    )
  )
  .protocols(httpProtocol)
  .maxDuration((rampDuration + testDuration).seconds)
  .assertions(
    global.responseTime.percentile(95).lt(8000),
    global.successfulRequests.percent.gt(50)
  )
}
