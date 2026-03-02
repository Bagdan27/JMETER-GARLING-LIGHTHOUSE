package simulations

import io.gatling.core.Predef._
import helpers.BaseHelpers._
import scenarios.UserScenarios
import scala.concurrent.duration._

class EcommerceSimulation extends Simulation {
  setUp(
    UserScenarios.scn.inject(
      rampConcurrentUsers(0).to(userCount).during(rampDuration.seconds),
      constantConcurrentUsers(userCount).during(testDuration.seconds)
    )
  )
  .protocols(httpProtocol)
  .maxDuration(totalDuration.seconds)
  .assertions(
    global.responseTime.percentile(95).lt(8000),
    global.successfulRequests.percent.gt(95)
  )
}
