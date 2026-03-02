package simulations

import io.gatling.core.Predef._
import helpers.BaseHelpers._
import scenarios.UserScenarios
import scala.concurrent.duration._

class EcommerceSimulation extends Simulation {

  setUp(
    UserScenarios.scn.inject(
      // 1. Разгоняем нагрузку от 0 до 50 ОДНОВРЕМЕННЫХ пользователей за 120 сек
      rampConcurrentUsers(0).to(userCount).during(rampDuration.seconds),

      // 2. Удерживаем ровно 50 ОДНОВРЕМЕННЫХ пользователей в течение 180 сек
      constantConcurrentUsers(userCount).during(testDuration.seconds)
    )
  )
  .protocols(httpProtocol)
  .assertions(
    global.responseTime.percentile(95).lt(5000),
    global.successfulRequests.percent.gt(95)
  )
}
