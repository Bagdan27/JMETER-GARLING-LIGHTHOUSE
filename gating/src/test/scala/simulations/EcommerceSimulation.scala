package simulations

import io.gatling.core.Predef._
import helpers.BaseHelpers._
import scenarios.UserScenarios
import scala.concurrent.duration._

class EcommerceSimulation extends Simulation {

  setUp(
    UserScenarios.scn.inject(
      // 1. Плавный разогрев — ramp до нужного кол-ва юзеров
      rampUsers(userCount).during(rampDuration.seconds),

      // 2. Держим нагрузку стабильной — тут и ищем точку насыщения
      constantUsersPerSec(userCount.toDouble / rampDuration.toDouble * userCount)
        .during(testDuration.seconds)
    )
  )
  .protocols(httpProtocol)
  .assertions(
    // Тест считается провальным если:
    global.responseTime.percentile(95).lt(5000),   // p95 < 5 сек
    global.successfulRequests.percent.gt(95)        // > 95% успешных запросов
  )
}
