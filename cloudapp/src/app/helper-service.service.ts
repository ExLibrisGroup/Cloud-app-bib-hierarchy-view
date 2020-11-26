import { Injectable } from "@angular/core";

@Injectable({
  providedIn: "root",
})
export class HelperService {
  public dummy = " asd";
  constructor() {}

  public formatItem(element: any): string {
    return (
      element.item_data?.barcode +
      (element.item_data?.base_status?.desc ? "/" + element.item_data.base_status.desc : "") +
      (element.item_data?.physical_material_type?.desc ? "/" + element.item_data?.physical_material_type?.desc : "") +
      `/${element.item_data.pid}`
    );
  }
  public formatHoldings(element: any): string {
    return (
      element.holding_id +
      " " +
      (element?.location?.desc ? element?.location?.desc : "") +
      "/" +
      element?.library?.desc +
      (element?.call_number ? "/" + element.call_number : "")
    );
  }
  public formatBibEntity(entity: any): string {
    return `${entity.mms_id}/ ${entity.title?entity.title:'unknown'} /${entity.author?entity.author:'unknown'};`
  }
  // formatBib(element:any):string
  // {

  // }
}
