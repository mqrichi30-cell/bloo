import { redirect } from "next/navigation";

/**
 * "Ventas" se fusionó con "Vender": registrar y revisar es el mismo flujo y
 * tenerlo en dos pestañas obligaba a saltar de una a otra. Esta ruta se
 * conserva solo para no romper enlaces viejos o pantallas guardadas en el
 * celular; redirige al módulo unificado.
 */
export default function VentasPage() {
  redirect("/vender");
}
