import { Subscription } from "rxjs";
import { ToastrService } from "ngx-toastr";
import { Component, OnInit, OnDestroy } from "@angular/core";
import { CloudAppEventsService, PageInfo } from "@exlibris/exl-cloudapp-angular-lib";
@Component({
  selector: "app-main",
  templateUrl: "./main.component.html",
  styleUrls: ["./main.component.scss"],
})
export class MainComponent implements OnInit, OnDestroy {
  pageLoad$: Subscription;
  toShow: boolean;
  constructor(private eventService: CloudAppEventsService) {}

  ngOnInit() {
    this.pageLoad$ = this.eventService.onPageLoad((pageInfo: PageInfo) => {
      this.toShow = !!(pageInfo?.entities?.length !== 0);
    });
  }
  ngOnDestroy() {
    this.pageLoad$.unsubscribe();
  }
  onPrint() {
    window.print();
  }
}
