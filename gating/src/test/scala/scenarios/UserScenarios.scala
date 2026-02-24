package scenarios

import io.gatling.core.Predef._
import io.gatling.http.Predef._
import scala.util.Random
import helpers.BaseHelpers._

object UserScenarios {


  val updateCartSession = (session: Session) => {
    val currentCart = session("cart_content").as[String]
    val pid = session("global_productId").as[String]
    val qty = session("current_quantity").as[String]

    val newItemEntry = s""""${pid}__":$qty"""

    val newCartContent = if (currentCart == "{}" || currentCart.isEmpty) {
      s"{$newItemEntry}"
    } else {
      currentCart.dropRight(1) + "," + newItemEntry + "}"
    }

    println(s"DEBUG: Cart updated. Was: '$currentCart', Added: $pid (x$qty), Becames: '$newCartContent'")

    session.set("cart_content", newCartContent)
  }

  def addToCart(productType: String) = {
    exec(http(s"Open Random $productType Product")
      .get("/products/${global_link}")
      .check(regex("""name="current_product"\s+value="(\d+)"""").saveAs("global_productId"))
    )
    .exec(thinkTime())
    .exec(session => {
        session.set("current_quantity", (1 + Random.nextInt(3)).toString)
    })
    .exec(http(s"Add $productType to Cart")
      .post("/wp-admin/admin-ajax.php")
      .formParam("action", "ic_add_to_cart")
      .formParam("add_cart_data", "current_product=${global_productId}&cart_content=${cart_content}&current_quantity=${current_quantity}")
      .formParam("cart_widget", "0")
      .formParam("cart_container", "0")
      .check(substring("Added!"))
    )
    .exec(updateCartSession)
  }

  val scn = scenario("E-commerce Load Test")
    .feed(csv("data/users.csv").circular)
    .exec(session => session.set("cart_content", "{}"))
    .exec(flushHttpCache)
    .exec(flushSessionCookies)
    .exec(flushCookieJar)
    .exitBlockOnFail {

      // 1. OPEN APPLICATION
      group("01_Open_Application") {
        exec(http("Open Homepage")
          .get("/")
          .check(status.is(200)))
          .exec(thinkTime(3, 5))
      }

      // 2. TABLES FLOW
      .group("02_Tables_Flow") {
        exec(http("Navigate Tables")
          .get("/tables")
          .check(regex("""href=".*?/products/([^"]+)"""").findRandom.saveAs("global_link"))
        )
        .exec(addToCart("Table"))
        .exec(thinkTime(2, 4))
      }

      // 3. CHAIRS FLOW (50%)
      .randomSwitch(
        50.0 -> group("03_Chairs_Flow") {
          exec(http("Navigate Chairs")
            .get("/chairs")
            .check(regex("""href=".*?/products/([^"]+)"""").findRandom.saveAs("global_link"))
          )
          .exec(addToCart("Chair"))
          .exec(thinkTime(3, 5))
        }
      )

      // 4. CHECKOUT FLOW (30%)
      .randomSwitch(
        30.0 -> group("04_Checkout_Flow") {
          exec(session => session.set("country_code", "ES"))
          .exec(http("Open Cart")
            .get("/cart")
            .check(css("input[name='trans_id']", "value").saveAs("trans_id"))
            .check(css("input[name='total_net']", "value").saveAs("total_net"))

            .check(css("option", "value").findRandom.optional.saveAs("country_code"))
          )
          .exec(thinkTime())

          .exec(http("Proceed to Checkout")
             .post("/checkout")
             .formParam("cart_content", "${cart_content}")
             .formParam("total_net", "${total_net}")
             .formParam("trans_id", "${trans_id}")
             .formParam("shipping", "order")
          )
          .exec(thinkTime())

          .exec(http("Pick Country")
            .post("/wp-admin/admin-ajax.php")
            .formParam("action", "ic_state_dropdown")
            .formParam("country_code", "${country_code}")
          )

          .exec(http("Place Order")
            .post("/checkout")
            .formParam("ic_formbuilder_redirect", "http://localhost/thank-you")
            .formParam("cart_content", "${cart_content}")
            .formParam("total_net", "${total_net}")
            .formParam("trans_id", "${trans_id}")
            .formParam("shipping", "order")
            .formParam("cart_type", "order")
            .formParam("cart_name", "${fullname}")
            .formParam("cart_email", "${email}")
            .formParam("cart_address", _ => "Calle " + Random.nextInt(100))
            .formParam("cart_postal", _ => (10000 + Random.nextInt(40000)).toString)
            .formParam("cart_city", "Madrid")
            .formParam("cart_country", "${country_code}")
            .formParam("cart_phone", "999888777")
            .formParam("cart_submit", " Place Order")
            .check(substring("Thank You"))
          )
        }
      )
    }
}