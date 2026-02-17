<?php
/**
 * 2007-2026 PrestaShop
 *
 * NOTICE OF LICENSE
 *
 * This source file is subject to the Academic Free License (AFL 3.0)
 * that is bundled with this package in the file LICENSE.txt.
 * It is also available through the world-wide-web at this URL:
 * http://opensource.org/licenses/afl-3.0.php
 * If you did not receive a copy of the license and are unable to
 * obtain it through the world-wide-web, please send an email
 * to license@prestashop.com so we can send you a copy immediately.
 *
 * DISCLAIMER
 *
 * Do not edit or add to this file if you wish to upgrade PrestaShop to newer
 * versions in the future. If you wish to customize PrestaShop for your
 * needs please refer to http://www.prestashop.com for more information.
 *
 *  @author    PrestaShop SA <contact@prestashop.com>
 *  @copyright 2007-2026 PrestaShop SA
 *  @license   http://opensource.org/licenses/afl-3.0.php  Academic Free License (AFL 3.0)
 *  International Registered Trademark & Property of PrestaShop SA
 */
if (!defined('_PS_VERSION_')) {
    exit;
}

class ZenocpgRedirectModuleFrontController extends ModuleFrontController
{
    /**
     * Do whatever you have to before redirecting the customer on the website of your payment processor.
     */
    public function postProcess()
    {
        $cart = $this->context->cart;
        $id_cart = $cart->id;
        $id_currency = $cart->id_currency;
        $currency = Currency::getIsoCodeById($id_currency);
        $amount = $cart->getOrderTotal(true, Cart::BOTH);
        $id_customer = $cart->id_customer;
        $customer = new Customer($id_customer);
        $secure_key = $customer->secure_key;
        $module_id = $this->module->id;
        $version = $this->module->version;

        $payment_status = (int) Configuration::getGlobalValue('ZENO_WAITING_PAYMENT');

        $this->module->validateOrder(
            (int) $id_cart,
            $payment_status,
            (float) $amount,
            $this->module->displayName,
            null,
            [],
            (int) $id_currency,
            false,
            $secure_key);

        $id_order = Order::getIdByCartId((int) $id_cart);
        $verification_token = hash_hmac('sha256', (string) $id_cart, $secure_key);
        /* echo $id_order." - ".$id_currency." - ".$amount." - ".$secure_key." - ".$currency." - ".$version." - ".$verification_token; */
        $success_url = $this->context->link->getModuleLink($this->module->name, 'confirmation', ['cart_id' => $id_cart], true);
        // $success_url = $this->getLinkZeno('index.php?controller=order-confirmation&id_cart=' . $id_cart . '&id_module=' . $module_id . '&id_order=' . $id_order . '&key=' . $secure_key);
        $no_payment_url = $this->getLinkZeno('index.php?controller=order');
        $webhook_url = $this->context->link->getBaseLink() . _WEBHOOK_ROUTE_;

        $payload = [
            'version' => (string) $version,
            'platform' => 'prestashop',
            'priceAmount' => (string) $amount,
            'priceCurrency' => (string) $currency,
            'orderId' => (string) $id_cart,
            'successRedirectUrl' => (string) $success_url,
            'verificationToken' => (string) $verification_token,
            'webhookUrl' => (string) $webhook_url,
        ];

        $payload = json_encode($payload);

        $headers = [
            'x-api-key: ' . (string) Configuration::get('ZENO_CPG_API_KEY', null),
            'Content-Type: application/json',
            'Accept: application/json',
            'X-Client-Type: plugin',
            'X-Client-Name: zeno-prestashop',
            'X-Client-Version: ' . (string) $version,
            'X-Client-Platform: prestashop',
            'X-Client-Platform-Version: ' . (string) _PS_VERSION_,
        ];

        $zeno_api_url = ZCPG_API_ENDPOINT . '/api/v1/checkouts';

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_URL, $zeno_api_url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_FAILONERROR, true);
        curl_setopt($ch, CURLINFO_HEADER_OUT, true);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        $response = curl_exec($ch);

        // Check for errors
        if (curl_errno($ch)) {
            echo 'Error:' . curl_error($ch);
            echo 'Error connecting with the gateway';
        }
        curl_close($ch);

        $body = json_decode($response, true);
        $payment_url = isset($body['checkoutUrl']) ? (string) $body['checkoutUrl'] : '';
        $payment_status = isset($body['status']) ? (string) $body['status'] : '';
        $id_zeno_payment = isset($body['id']) ? (string) $body['id'] : '';

        if (!$payment_url) {
            Tools::redirect($no_payment_url);
        } else {
            $query_find = 'SELECT id_cart FROM `' . _DB_PREFIX_ . _ZENO_DB_TABLE_ . '` WHERE id_cart = ' . $id_cart;
            $cart_ids = Db::getInstance()->ExecuteS($query_find);

            // Prepare data for database
            $current_date = date('Y-m-d H:i:s');

            if (count($cart_ids) == 0) {
                // Insert new record
                $query_insert = "INSERT INTO `" . _DB_PREFIX_ . _ZENO_DB_TABLE_ . "` (id_cart, id_zeno_payment, date_created) VALUES ('" . (int) $id_cart . "', '" . pSQL($id_zeno_payment) . "', '" . pSQL($current_date) . "')";
                $result = Db::getInstance()->execute($query_insert);
            } else {
                // Update existing record
                $query_update = "UPDATE `" . _DB_PREFIX_ . _ZENO_DB_TABLE_ . "` SET id_cart = '" . (int) $id_cart . "', id_zeno_payment = '" . pSQL($id_zeno_payment) . "', date_created = '" . pSQL($current_date) . "' WHERE id_cart = '" . $id_cart . "'";
                $result = Db::getInstance()->execute($query_update);
            }

            Tools::redirect($payment_url);
        }
    }

    protected function displayError($message, $description = false)
    {
        /*
         * Create the breadcrumb for your ModuleFrontController.
         */
        $this->context->smarty->assign('path', '
			<a href="' . $this->context->link->getPageLink('order', null, null, 'step=3') . '">' . $this->module->l('Payment') . '</a>
			<span class="navigation-pipe">&gt;</span>' . $this->module->l('Error'));

        /*
         * Set error message and description for the template.
         */
        array_push($this->errors, $this->module->l($message), $description);
        return $this->setTemplate('error.tpl');
    }

    public function getLinkZeno($url, $base_uri = __PS_BASE_URI__, Link $link = null)
    {
        if (!$link) {
            $link = $this->context->link;
        }

        if (!preg_match('@^https?://@i', $url) && $link) {
            if (strpos($url, $base_uri) === 0) {
                $url = substr($url, strlen($base_uri));
            }
            if (strpos($url, 'index.php?controller=') === 0) {
                $url = substr($url, strlen('index.php?controller='));
                if (Configuration::get('PS_REWRITING_SETTINGS')) {
                    $url = Tools::strReplaceFirst('&', '?', $url);
                }
            }

            $explode = explode('?', $url);
            $url = $link->getPageLink($explode[0]);
            if (isset($explode[1])) {
                $url .= '?' . $explode[1];
            }
        }
        return $url;
    }
}
