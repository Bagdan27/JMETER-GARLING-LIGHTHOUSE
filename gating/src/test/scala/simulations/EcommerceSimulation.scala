package simulations

import io.gatling.core.Predef._
import io.gatling.commons.validation._
import helpers.BaseHelpers._
import scenarios.UserScenarios
import scala.concurrent.duration._

class EcommerceSimulation extends Simulation {
  setUp(
    UserScenarios.scn.inject(
      rampUsers(userCount).during(rampDuration.seconds)
    )
  ).protocols(httpProtocol)
}