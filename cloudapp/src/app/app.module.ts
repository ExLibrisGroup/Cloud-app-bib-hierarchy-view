import { NgModule } from "@angular/core";
import { HttpClientModule } from "@angular/common/http";
import { BrowserModule } from "@angular/platform-browser";
import { BrowserAnimationsModule } from "@angular/platform-browser/animations";
import { MaterialModule, getTranslateModule } from "@exlibris/exl-cloudapp-angular-lib";
import { ToastrModule } from "ngx-toastr";
import { MatTreeModule } from "@angular/material/tree";
import { AppComponent } from "./app.component";
import { AppRoutingModule } from "./app-routing.module";
import { MainComponent } from "./main/main.component";
import { FormsModule } from "@angular/forms";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatSelectModule } from "@angular/material/select";
import { MatTooltipModule } from "@angular/material/tooltip";
import { MatRadioModule } from "@angular/material/radio";
import { MatInputModule } from "@angular/material/input";
import { MatFormFieldModule } from "@angular/material/form-field";
import {MatSlideToggleModule} from '@angular/material/slide-toggle';
import { BibDynamicTree } from "./bib-tree/bib-tree.component";
import { HelpComponent } from './help/help.component';



export function getToastrModule() {
  return ToastrModule.forRoot({
    positionClass: "toast-top-right",
    timeOut: 2000,
  });
}

@NgModule({
  declarations: [AppComponent, MainComponent,BibDynamicTree, HelpComponent],
  imports: [
    MaterialModule,
    BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    HttpClientModule,
    MatTreeModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatSelectModule,
    MatTooltipModule,
    MatRadioModule,
    MatSlideToggleModule,
    getTranslateModule(),
    getToastrModule(),
  ],
  providers: [],
  bootstrap: [AppComponent],
})
export class AppModule {}
