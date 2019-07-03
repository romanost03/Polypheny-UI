import {Component, OnDestroy, OnInit} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {TableConfig} from '../../components/data-table/table-config';
import {CrudService} from '../../services/crud.service';
import {LeftSidebarService} from '../../components/left-sidebar/left-sidebar.service';
import {ResultSet} from '../../components/data-table/models/result-set.model';
import {SchemaRequest, TableRequest, UIRequest} from '../../models/ui-request.model';

@Component({
  selector: 'app-table-view',
  templateUrl: './table-view.component.html',
  styleUrls: ['./table-view.component.scss']
})
export class TableViewComponent implements OnInit, OnDestroy {

  tableId = '';
  currentPage = 1;
  resultSet: ResultSet;
  tableConfig: TableConfig = {
    create: true,
    search: true,
    sort: true,
    update: true,
    delete: true
  };
  loading: boolean;

  constructor(
      private _route: ActivatedRoute,
      private _crud:CrudService,
      private _sidebar: LeftSidebarService) { }

  ngOnInit() {

    this._sidebar.open();

    this.tableId = this._route.snapshot.paramMap.get('id');
    if( this._route.snapshot.paramMap.get('page') ){
      this.currentPage = +this._route.snapshot.paramMap.get('page');
    }else {
      this.currentPage = 1;
    }
    if( this.resultSet ) this.resultSet.currentPage = this.currentPage;

    this._sidebar.setSchema( new SchemaRequest('/views/data-table/', true) );

    //listen to parameter changes
    this._route.params.subscribe((params) => {
      this.tableId = params['id'];
      if( this._route.snapshot.paramMap.get('page') ){
        this.currentPage = +this._route.snapshot.paramMap.get('page');
      }else {
        this.currentPage = 1;
      }
      if( this.resultSet ){
        this.resultSet.currentPage = this.currentPage;
      }
      this.getTable();
    });

  }

  getTable() {
    if( this.tableId ) {
      this.loading = true;
      const req: UIRequest  = new TableRequest( this.tableId, this.currentPage );
      this._crud.getTable( req ).subscribe(
        res => {
          this.resultSet = <ResultSet> res;
          if( this.resultSet.type === 'TABLE') {
            this.tableConfig.create = true;
            this.tableConfig.update = true;
            this.tableConfig.delete = true;
          } else {
            this.tableConfig.create = false;
            this.tableConfig.update = false;
            this.tableConfig.delete = false;
          }
          this.loading = false;
        }, err => {
          console.log(err);
          this.loading = false;
        }
      );
    }

  }

  ngOnDestroy() {
    this._sidebar.close();
  }

}
