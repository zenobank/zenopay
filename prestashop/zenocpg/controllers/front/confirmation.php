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

class ZenocpgConfirmationModuleFrontController extends ModuleFrontController
{
    public function postProcess()
    {
        if (!isset($_GET['cart_id'])) {
            Tools::redirect('index.php?controller=order');
            return;
        }

        $id_cart = (int) $_GET['cart_id'];
        $cart = new Cart($id_cart);

        if (!Validate::isLoadedObject($cart)) {
            Tools::redirect('index.php?controller=order');
            return;
        }

        $id_customer = $cart->id_customer;
        $customer = new Customer($id_customer);
        $secure_key = $customer->secure_key;
        $id_order = Order::getIdByCartId($id_cart);

        if (!$id_order) {
            Tools::redirect('index.php?controller=order');
            return;
        }

        $query_find = 'SELECT id_zeno_payment FROM `' . _DB_PREFIX_ . _ZENO_DB_TABLE_ . '` WHERE id_cart = ' . $id_cart;
        $id_zeno_payment = Db::getInstance()->getValue($query_find);

        if ($id_zeno_payment) {
            $headers = [
                'Content-Type: application/json',
                'Accept: application/json',
            ];

            $zeno_api_url = ZCPG_API_ENDPOINT . '/api/v1/checkouts/' . $id_zeno_payment;

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
            curl_setopt($ch, CURLOPT_URL, $zeno_api_url);
            curl_setopt($ch, CURLOPT_POST, false);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_FAILONERROR, true);
            curl_setopt($ch, CURLINFO_HEADER_OUT, true);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            $response = curl_exec($ch);
            curl_close($ch);

            if ($response) {
                $body = json_decode($response, true);
                $order_status_back = isset($body['status']) ? (string) $body['status'] : '';

                if ($order_status_back == 'COMPLETED') {
                    $pr_order_status_complete = (int) Configuration::get('ZENO_PAYMENT_ACCEPTED');
                    if (!$pr_order_status_complete) {
                        $pr_order_status_complete = (int) Configuration::get('PS_OS_PAYMENT');
                    }
                    $this->order_complete_status((int) $id_order, $pr_order_status_complete);
                }
            }
        }

        Tools::redirect(
            'index.php?controller=order-confirmation&id_cart=' . $id_cart
            . '&id_module=' . $this->module->id
            . '&id_order=' . $id_order
            . '&key=' . $secure_key
        );
    }

    public function order_complete_status($id_order, $pr_order_status_complete)
    {
        $order = new Order((int) $id_order);
        if (!Validate::isLoadedObject($order)) {
            return false;
        }

        $new_history = new OrderHistory();
        $new_history->id_order = (int) $id_order;
        $result = $new_history->changeIdOrderState((int) $pr_order_status_complete, (int) $id_order, true);
        $new_history->add();
        if (!$result) {
            return false;
        }
        /*
        // Synchronize stock if advanced stock management is enabled
        if (Configuration::get('PS_ADVANCED_STOCK_MANAGEMENT')) {
            foreach ($order->getProducts() as $product) {
                if (StockAvailable::dependsOnStock($product['product_id'])) {
                    StockAvailable::synchronize($product['product_id'], (int)$order->id_shop);
                }
            }
        }*/

        return true;
    }
}
